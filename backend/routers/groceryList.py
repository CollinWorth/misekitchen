import uuid
from fastapi import APIRouter, HTTPException
from model import GroceryList, GroceryItem
from pydantic import BaseModel
from bson import ObjectId
from database import grocery_collection, mealPlans_collection, recipes_collection, parse_object_id
from datetime import date, timedelta

router = APIRouter()

def convert_object_ids(doc):
    """
    Recursively converts any ObjectId fields in a MongoDB document to strings.
    """
    if isinstance(doc, list):
        return [convert_object_ids(item) for item in doc]
    elif isinstance(doc, dict):
        return {key: convert_object_ids(value) for key, value in doc.items()}
    elif isinstance(doc, ObjectId):
        return str(doc)
    else:
        return doc


async def _ensure_item_ids(doc: dict) -> dict:
    """Give items saved before ids existed an id, persisted so it stays stable across reads."""
    for i, item in enumerate(doc.get("items", [])):
        if item.get("id"):
            continue
        item["id"] = uuid.uuid4().hex
        await grocery_collection.update_one(
            {"_id": doc["_id"], f"items.{i}.name": item.get("name"), f"items.{i}.id": {"$in": [None, ""]}},
            {"$set": {f"items.{i}.id": item["id"]}}
        )
    return doc


def _unit_key(unit: str | None) -> str:
    """Units compare case- and whitespace-insensitively ("Cup " == "cup")."""
    return (unit or "").strip().lower()


def _fmt_qty(n: float) -> str:
    """Format a float quantity to a clean string (e.g. 2.0 → '2', 1.5 → '1.5')."""
    if n == int(n):
        return str(int(n))
    return str(round(n, 2))


class GroceryItemUpdate(BaseModel):
    name: str | None = None
    quantity: str | None = None
    unit: str | None = None


class FromMealPlanRequest(BaseModel):
    user_id: str
    start_date: str | None = None   # YYYY-MM-DD (used if recipe_ids not provided)
    end_date: str | None = None     # YYYY-MM-DD
    recipe_ids: list[str] | None = None  # explicit IDs, may include duplicates


@router.get("/week-meals")
async def get_week_meals(user_id: str, start_date: str, end_date: str):
    """Return all planned meals for a week range, enriched with recipe name."""
    try:
        user_obj_id = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    dates = [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]
    plans = await mealPlans_collection.find({
        "user_id": user_obj_id, "date": {"$in": dates}
    }).to_list(length=None)
    results = []
    for plan in plans:
        recipe_name, image_url, servings = "Unknown recipe", "", 0
        try:
            r = await recipes_collection.find_one({"_id": plan["recipe_id"]})
            if r:
                recipe_name = r.get("recipe_name", "Unknown recipe")
                image_url = r.get("image_url", "") or ""
                servings = int(r.get("servings") or 0)
        except Exception:
            pass
        results.append({
            "meal_plan_id": str(plan["_id"]),
            "recipe_id": str(plan["recipe_id"]),
            "recipe_name": recipe_name,
            "image_url": image_url,
            "date": plan["date"],
            "servings": servings,
        })
    return results


@router.post("/from-meal-plan")
async def generate_from_meal_plan(body: FromMealPlanRequest):
    try:
        user_obj_id = ObjectId(body.user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")

    # Build recipe_id list — keeps duplicates so quantities multiply correctly
    if body.recipe_ids:
        recipe_id_list = body.recipe_ids
    elif body.start_date and body.end_date:
        start = date.fromisoformat(body.start_date)
        end = date.fromisoformat(body.end_date)
        dates = [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]
        plans = await mealPlans_collection.find({
            "user_id": user_obj_id, "date": {"$in": dates}
        }).to_list(length=None)
        if not plans:
            return {"added": 0, "message": "No meals planned for this week"}
        recipe_id_list = [str(p["recipe_id"]) for p in plans]  # intentional duplicates
    else:
        raise HTTPException(status_code=400, detail="Provide recipe_ids or start_date/end_date")

    if not recipe_id_list:
        return {"added": 0, "message": "No meals to process"}

    # Count how many times each recipe appears (for quantity multiplication)
    recipe_count: dict[str, int] = {}
    for rid in recipe_id_list:
        recipe_count[rid] = recipe_count.get(rid, 0) + 1

    # Fetch unique recipes
    recipes_by_id: dict[str, dict] = {}
    for rid in recipe_count:
        try:
            r = await recipes_collection.find_one({"_id": ObjectId(rid)})
            if r:
                recipes_by_id[rid] = r
        except Exception:
            pass

    # Aggregate ingredients, multiplying quantities by occurrence count
    aggregated: dict[str, dict] = {}
    for rid, count in recipe_count.items():
        recipe = recipes_by_id.get(rid)
        if not recipe:
            continue
        for ing in recipe.get("ingredients", []):
            key = ing.get("name", "").strip().lower()
            if not key:
                continue
            try:
                ing_qty = float(ing.get("quantity") or 0) * count
            except (ValueError, TypeError):
                ing_qty = 0

            if key in aggregated:
                try:
                    existing_qty = float(aggregated[key]["quantity"] or 0)
                    combined = existing_qty + ing_qty
                    if combined > 0:
                        aggregated[key]["quantity"] = _fmt_qty(combined)
                except (ValueError, TypeError):
                    pass
            else:
                raw_qty = ing.get("quantity")
                if ing_qty and raw_qty:
                    qty_str = _fmt_qty(ing_qty)
                elif raw_qty:
                    qty_str = str(raw_qty)
                else:
                    qty_str = ""
                aggregated[key] = {
                    "name": ing.get("name", "").strip(),
                    "quantity": qty_str,
                    "unit": ing.get("unit", "") or "",
                    "category": "other",
                    "checked": False,
                }

    if not aggregated:
        return {"added": 0, "message": "Recipes have no ingredients"}

    # Find or create grocery list
    grocery_list = await grocery_collection.find_one({"user_id": user_obj_id})
    if not grocery_list:
        result = await grocery_collection.insert_one({
            "user_id": user_obj_id, "name": "My List", "items": []
        })
        grocery_list = await grocery_collection.find_one({"_id": result.inserted_id})

    list_id = grocery_list["_id"]
    existing_names = {i.get("name", "").lower() for i in grocery_list.get("items", [])}

    # Merge: if item already exists in list, try to combine quantities
    to_add = []
    to_update = []  # (name, new_qty)
    for key, item in aggregated.items():
        if key in existing_names:
            existing = next((i for i in grocery_list.get("items", []) if i.get("name", "").lower() == key), None)
            if existing:
                try:
                    combined = float(existing.get("quantity") or 0) + float(item["quantity"] or 0)
                    if combined > 0:
                        to_update.append((existing["name"], _fmt_qty(combined)))
                except (ValueError, TypeError):
                    pass  # Don't update if can't combine
        else:
            to_add.append(item)

    if to_add:
        await grocery_collection.update_one(
            {"_id": list_id},
            {"$push": {"items": {"$each": to_add}}}
        )
    for name, new_qty in to_update:
        await grocery_collection.update_one(
            {"_id": list_id, "items.name": name},
            {"$set": {"items.$.quantity": new_qty}}
        )

    return {"added": len(to_add), "updated": len(to_update), "skipped": len(aggregated) - len(to_add) - len(to_update)}


# Create a new grocery list
@router.post("/")
async def create_grocery_list(grocery: GroceryList):
    grocery_dict = grocery.model_dump(by_alias=True)
    grocery_dict["user_id"] = parse_object_id(grocery_dict["user_id"], "user_id")
    result = await grocery_collection.insert_one(grocery_dict)
    if not result.inserted_id:
        raise HTTPException(status_code=500, detail="Failed to create grocery list")
    created = await grocery_collection.find_one({"_id": result.inserted_id})
    return convert_object_ids(created)
    

@router.get("/userID/{user_id}")
async def get_grocery_lists_userID(user_id: str):
    try:
        user_obj_id = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Invalid user ID format")
    
    grocery_lists = await grocery_collection.find({"user_id": user_obj_id}).to_list(length=100)
    grocery_lists = [await _ensure_item_ids(g) for g in grocery_lists]

    return convert_object_ids(grocery_lists)
    
    

# Get a grocery list by its ID
@router.get("/listID/{grocery_list_id}")
async def get_grocery_list_listID(grocery_list_id: str):
    try:
        obj_id = ObjectId(grocery_list_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid grocery list ID format")

    grocery_list = await grocery_collection.find_one({"_id": obj_id})
    if not grocery_list:
        raise HTTPException(status_code=404, detail="Grocery list not found")

    grocery_list = await _ensure_item_ids(grocery_list)
    return convert_object_ids(grocery_list)

# Add a new grocery item to the list (or update quantity if item exists)
@router.put("/{grocery_list_id}")
async def add_grocery_item(grocery_list_id: str, item: GroceryItem):
    try:
        obj_id = ObjectId(grocery_list_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid grocery list ID")
    grocery_list = await grocery_collection.find_one({"_id": obj_id})
    if not grocery_list:
        raise HTTPException(status_code=404, detail="Grocery list not found")

    grocery_list = await _ensure_item_ids(grocery_list)
    item_dict = item.dict(by_alias=True)

    # Same name and same unit: add quantities and append sources.
    # A different unit gets its own line so nothing is dropped.
    existing_item = next(
        (i for i in grocery_list.get("items", [])
         if i.get("name") == item.name and _unit_key(i.get("unit")) == _unit_key(item.unit)),
        None,
    )
    if existing_item:
        # Combine quantities safely — both may be fractions or empty
        try:
            combined = float(existing_item.get("quantity") or 0) + float(item.quantity or 0)
            new_qty = _fmt_qty(combined) if combined > 0 else (existing_item.get("quantity") or "")
        except (ValueError, TypeError):
            new_qty = existing_item.get("quantity") or item.quantity or ""
        await grocery_collection.update_one(
            {"_id": obj_id, "items.id": existing_item["id"]},
            {
                "$set": {"items.$.quantity": new_qty},
                "$push": {"items.$.sources": {"$each": item_dict["sources"]}},
            }
        )
        return {"message": f"Updated '{item.name}'", "quantity": new_qty}

    # New item — push to list
    await grocery_collection.update_one(
        {"_id": obj_id},
        {"$push": {"items": item_dict}}
    )
    return {"message": f"Added '{item.name}'", "item": item_dict}


# Toggle checked state of an item
@router.patch("/{grocery_list_id}/{item_name}/check")
async def toggle_grocery_item(grocery_list_id: str, item_name: str):
    try:
        obj_id = ObjectId(grocery_list_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid grocery list ID")
    grocery_list = await grocery_collection.find_one({"_id": obj_id})
    if not grocery_list:
        raise HTTPException(status_code=404, detail="Grocery list not found")
    items = grocery_list.get("items", [])
    # Case-insensitive fallback so minor name drift doesn't break toggling
    current = next((i for i in items if i.get("name") == item_name), None)
    if current is None:
        current = next((i for i in items if i.get("name", "").lower() == item_name.lower()), None)
    if current is None:
        raise HTTPException(status_code=404, detail="Item not found")
    stored_name = current["name"]
    new_checked = not current.get("checked", False)
    await grocery_collection.update_one(
        {"_id": obj_id, "items.name": stored_name},
        {"$set": {"items.$.checked": new_checked}}
    )
    return {"checked": new_checked}


# Edit an item's name, quantity or unit in place. Only the display total changes; sources are left alone.
@router.patch("/{grocery_list_id}/items/{item_id}")
async def edit_grocery_item(grocery_list_id: str, item_id: str, body: GroceryItemUpdate):
    obj_id = parse_object_id(grocery_list_id, "grocery list ID")
    grocery_list = await grocery_collection.find_one({"_id": obj_id})
    if not grocery_list:
        raise HTTPException(status_code=404, detail="Grocery list not found")
    grocery_list = await _ensure_item_ids(grocery_list)
    current = next((i for i in grocery_list.get("items", []) if i.get("id") == item_id), None)
    if current is None:
        raise HTTPException(status_code=404, detail="Item not found")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "name" in updates:
        updates["name"] = updates["name"].strip()
        if not updates["name"]:
            raise HTTPException(status_code=400, detail="Name cannot be empty")
    if updates:
        await grocery_collection.update_one(
            {"_id": obj_id, "items.id": item_id},
            {"$set": {f"items.$.{k}": v for k, v in updates.items()}}
        )
    return {"message": f"Updated '{updates.get('name', current['name'])}'", "item": {**current, **updates}}


# Toggle checked state by item id (names can be empty or duplicated)
@router.patch("/{grocery_list_id}/items/{item_id}/check")
async def toggle_grocery_item_by_id(grocery_list_id: str, item_id: str):
    obj_id = parse_object_id(grocery_list_id, "grocery list ID")
    grocery_list = await grocery_collection.find_one({"_id": obj_id})
    if not grocery_list:
        raise HTTPException(status_code=404, detail="Grocery list not found")
    grocery_list = await _ensure_item_ids(grocery_list)
    current = next((i for i in grocery_list.get("items", []) if i.get("id") == item_id), None)
    if current is None:
        raise HTTPException(status_code=404, detail="Item not found")
    new_checked = not current.get("checked", False)
    await grocery_collection.update_one(
        {"_id": obj_id, "items.id": item_id},
        {"$set": {"items.$.checked": new_checked}}
    )
    return {"checked": new_checked}


# Delete one item by id
@router.delete("/{grocery_list_id}/items/{item_id}")
async def delete_grocery_item_by_id(grocery_list_id: str, item_id: str):
    obj_id = parse_object_id(grocery_list_id, "grocery list ID")
    grocery_list = await grocery_collection.find_one({"_id": obj_id})
    if not grocery_list:
        raise HTTPException(status_code=404, detail="Grocery list not found")
    await _ensure_item_ids(grocery_list)
    result = await grocery_collection.update_one(
        {"_id": obj_id},
        {"$pull": {"items": {"id": item_id}}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"message": "Item deleted"}


# Clear all items (or just checked items) from a list in one query
@router.delete("/{grocery_list_id}")
async def clear_grocery_items(grocery_list_id: str, checked_only: bool = False):
    try:
        obj_id = ObjectId(grocery_list_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid grocery list ID")
    if checked_only:
        result = await grocery_collection.update_one(
            {"_id": obj_id},
            {"$pull": {"items": {"checked": True}}}
        )
    else:
        result = await grocery_collection.update_one(
            {"_id": obj_id},
            {"$set": {"items": []}}
        )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Grocery list not found")
    return {"cleared": True}


# Delete a grocery item by name from the list
@router.delete("/{grocery_list_id}/{item_name}")
async def delete_grocery_item(grocery_list_id: str, item_name: str):
    grocery_list = await grocery_collection.find_one({"_id": ObjectId(grocery_list_id)})
    if not grocery_list:
        raise HTTPException(status_code=404, detail="Grocery list not found")
    
    result = await grocery_collection.update_one(
        {"_id": ObjectId(grocery_list_id)},
        {"$pull": {"items": {"name": item_name}}}
    )

    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail=f"Item '{item_name}' not found in grocery list")

    return {"message": f"Item '{item_name}' deleted from grocery list"}

