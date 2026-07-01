from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from bson import ObjectId
from database import mealPlans_collection

router = APIRouter()

class MealPlanBody(BaseModel):
    multiplier: int = 1

def _convert(document):
    document["_id"] = str(document["_id"])
    document["user_id"] = str(document["user_id"])
    document["recipe_id"] = str(document["recipe_id"])
    if "multiplier" not in document:
        document["multiplier"] = 1
    return document

@router.get("/{date}/{userId}")
async def get_meal_plans(date: str, userId: str):
    try:
        print(f"Fetching meal plans for date: {date}, userId: {userId}")

        try:
            user_obj_id = ObjectId(userId)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid userId format")

        meal_plans = await mealPlans_collection.find({"user_id": user_obj_id, "date": date}).to_list(length=None)
        meal_plans = [_convert(meal) for meal in meal_plans]
        print(f"Meal plans fetched: {meal_plans}")
        return meal_plans
    except Exception as e:
        print(f"Error fetching meal plans: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch meal plans: {str(e)}")

@router.get("/range/{start}/{end}/{userId}")
async def get_meal_plans_range(start: str, end: str, userId: str):
    try:
        print(f"Fetching meal plans in range {start}..{end} for userId: {userId}")

        try:
            user_obj_id = ObjectId(userId)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid userId format")

        # Dates are "YYYY-MM-DD" strings, which sort lexicographically, so an
        # inclusive range query works with a single indexed lookup (no per-day loop).
        meal_plans = await mealPlans_collection.find({
            "user_id": user_obj_id,
            "date": {"$gte": start, "$lte": end},
        }).to_list(length=None)

        grouped = {}
        for meal in meal_plans:
            meal = _convert(meal)
            grouped.setdefault(meal["date"], []).append(meal)

        print(f"Meal plans fetched in range: {len(meal_plans)} across {len(grouped)} days")
        return grouped
    except Exception as e:
        print(f"Error fetching meal plans range: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch meal plans: {str(e)}")

@router.post("/Create/{date}/{userId}/{recipeId}")
async def create_meal_plan(date: str, userId: str, recipeId: str, body: Optional[MealPlanBody] = None):
    try:
        user_obj_id = ObjectId(userId)
        recipe_obj_id = ObjectId(recipeId)
        multiplier = max(1, body.multiplier if body else 1)

        result = await mealPlans_collection.insert_one({
            "user_id": user_obj_id,
            "recipe_id": recipe_obj_id,
            "date": date,
            "multiplier": multiplier,
        })

        new_meal_plan = await mealPlans_collection.find_one({"_id": result.inserted_id})
        return _convert(new_meal_plan)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create meal plan: {str(e)}")

@router.delete("/Delete/{mealPlanId}")
async def delete_meal_plan(mealPlanId: str):
    try:
        # Convert mealPlanId to ObjectId
        try:
            meal_plan_obj_id = ObjectId(mealPlanId)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid mealPlanId format")

        # Delete the meal plan from the database
        result = await mealPlans_collection.find_one_and_delete({"_id": meal_plan_obj_id})
        if not result:
            raise HTTPException(status_code=404, detail="Meal plan not found")
        return {"message": "Meal plan deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete meal plan: {str(e)}")