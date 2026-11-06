import asyncio
import re
from fastapi import APIRouter, HTTPException, Body, Depends
from database import users_collection as db, recipes_collection, follows_collection, parse_object_id
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, field_validator
from bson import ObjectId
from auth import create_access_token, get_current_user_id

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
MIN_PASSWORD_LENGTH = 8


def normalize_email(email: str) -> str:
    return email.strip().lower()


def find_users_by_email(email: str, exclude_id=None):
    """Case-insensitive lookup, so accounts stored before emails were lowercased still match."""
    query = {"email": {"$regex": f"^{re.escape(normalize_email(email))}$", "$options": "i"}}
    if exclude_id is not None:
        query["_id"] = {"$ne": exclude_id}
    return db.find(query)


class UserIn(BaseModel):
    name: str
    email: EmailStr
    password: str

    @field_validator("email", mode="before")
    @classmethod
    def _normalize_email(cls, v):
        return normalize_email(v) if isinstance(v, str) else v

class ProfileUpdate(BaseModel):
    name: str
    email: EmailStr

    @field_validator("email", mode="before")
    @classmethod
    def _normalize_email(cls, v):
        return normalize_email(v) if isinstance(v, str) else v

class PasswordChange(BaseModel):
    current_password: str
    new_password: str

class AccountDelete(BaseModel):
    password: str


@router.post("/")
async def create_user(user: UserIn):
    if len(user.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    existing = await find_users_by_email(user.email).to_list(1)
    if existing:
        raise HTTPException(status_code=400, detail="Email already exists")
    user_dict = user.model_dump()
    user_dict["password"] = pwd_context.hash(user_dict["password"])
    result = await db.insert_one(user_dict)
    return {"id": str(result.inserted_id), "message": "User created successfully"}


@router.post("/login")
async def login_user(data: dict = Body(...)):
    email = data.get("email")
    password = data.get("password")
    if not isinstance(email, str) or not isinstance(password, str) or not email.strip() or not password:
        raise HTTPException(status_code=400, detail="Email and password are required")
    # Match any case variant; use the account whose password checks out.
    user = None
    async for candidate in find_users_by_email(email):
        if pwd_context.verify(password, candidate["password"]):
            user = candidate
            break
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    user_id = str(user["_id"])
    token = create_access_token(user_id)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user_id, "name": user.get("name"), "email": user.get("email")},
    }


@router.get("/me")
async def get_me(user_id: str = Depends(get_current_user_id)):
    user = await db.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": str(user["_id"]), "name": user.get("name"), "email": user.get("email")}


@router.put("/me")
async def update_profile(data: ProfileUpdate, user_id: str = Depends(get_current_user_id)):
    existing = await find_users_by_email(data.email, exclude_id=ObjectId(user_id)).to_list(1)
    if existing:
        raise HTTPException(status_code=400, detail="Email already in use")
    await db.update_one({"_id": ObjectId(user_id)}, {"$set": {"name": data.name, "email": data.email}})
    return {"id": user_id, "name": data.name, "email": data.email}


@router.put("/me/password")
async def change_password(data: PasswordChange, user_id: str = Depends(get_current_user_id)):
    user = await db.find_one({"_id": ObjectId(user_id)})
    if not user or not pwd_context.verify(data.current_password, user["password"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(data.new_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"New password must be at least {MIN_PASSWORD_LENGTH} characters")
    hashed = pwd_context.hash(data.new_password)
    await db.update_one({"_id": ObjectId(user_id)}, {"$set": {"password": hashed}})
    return {"message": "Password updated"}


@router.delete("/me")
async def delete_account(data: AccountDelete, user_id: str = Depends(get_current_user_id)):
    user = await db.find_one({"_id": ObjectId(user_id)})
    if not user or not pwd_context.verify(data.password, user["password"]):
        raise HTTPException(status_code=400, detail="Incorrect password")
    oid = ObjectId(user_id)
    await asyncio.gather(
        db.delete_one({"_id": oid}),
        recipes_collection.delete_many({"user_id": oid}),
        follows_collection.delete_many({"$or": [{"follower_id": user_id}, {"following_id": user_id}]}),
    )
    return {"message": "Account deleted"}


@router.get("/search")
async def search_users(q: str = ""):
    if not q.strip():
        return []
    cursor = db.find({"name": {"$regex": re.escape(q.strip()), "$options": "i"}}).limit(20)
    users = []
    async for u in cursor:
        users.append(u)
    if not users:
        return []
    counts = await asyncio.gather(*[
        recipes_collection.count_documents({"user_id": u["_id"], "is_public": True, "is_modified": {"$ne": True}, "original_recipe_id": None})
        for u in users
    ] + [
        follows_collection.count_documents({"following_id": str(u["_id"])})
        for u in users
    ])
    n = len(users)
    return [
        {"id": str(u["_id"]), "name": u.get("name", ""), "recipe_count": counts[i], "follower_count": counts[n + i]}
        for i, u in enumerate(users)
    ]


@router.get("/browse")
async def browse_users():
    users = []
    async for u in db.find({}, {"name": 1}).limit(100):
        users.append(u)
    if not users:
        return []
    n = len(users)
    results = await asyncio.gather(*[
        recipes_collection.count_documents({"user_id": u["_id"], "is_public": True, "is_modified": {"$ne": True}, "original_recipe_id": None})
        for u in users
    ] + [
        follows_collection.count_documents({"following_id": str(u["_id"])})
        for u in users
    ] + [
        recipes_collection.find_one(
            {"user_id": u["_id"], "is_public": True, "is_modified": {"$ne": True}, "original_recipe_id": None, "image_url": {"$exists": True, "$gt": ""}},
            {"image_url": 1}
        )
        for u in users
    ])
    recipe_counts  = results[:n]
    follower_counts = results[n:2*n]
    sample_docs    = results[2*n:]
    combined = [
        {
            "id": str(u["_id"]),
            "name": u.get("name", ""),
            "recipe_count": rc,
            "follower_count": fc,
            "sample_image": (sd or {}).get("image_url") or None,
        }
        for u, rc, fc, sd in zip(users, recipe_counts, follower_counts, sample_docs)
    ]
    combined.sort(key=lambda x: x["recipe_count"], reverse=True)
    return combined[:30]


@router.get("/{user_id}/followers")
async def get_followers(user_id: str):
    cursor = follows_collection.find({"following_id": user_id})
    results = []
    async for f in cursor:
        follower_id = f.get("follower_id")
        if not follower_id:
            continue
        try:
            user = await db.find_one({"_id": ObjectId(follower_id)})
        except Exception:
            continue
        if user:
            results.append({"id": str(user["_id"]), "name": user.get("name", "")})
    return results


@router.get("/{user_id}/following")
async def get_following(user_id: str):
    cursor = follows_collection.find({"follower_id": user_id})
    results = []
    async for f in cursor:
        following_id = f.get("following_id")
        if not following_id:
            continue
        try:
            user = await db.find_one({"_id": ObjectId(following_id)})
        except Exception:
            continue
        if user:
            results.append({"id": str(user["_id"]), "name": user.get("name", "")})
    return results


@router.get("/{user_id}/recipes")
async def get_user_public_recipes(user_id: str):
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    cursor = recipes_collection.find({"user_id": oid, "is_public": True, "is_modified": {"$ne": True}, "original_recipe_id": None})
    results = []
    async for r in cursor:
        r["_id"] = str(r["_id"])
        r["user_id"] = str(r["user_id"])
        results.append(r)
    return results


@router.get("/{user_id}")
async def get_user(user_id: str):
    user = await db.find_one({"_id": parse_object_id(user_id, "user_id")})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    uid = str(user["_id"])
    follower_count, following_count, recipe_count = await asyncio.gather(
        follows_collection.count_documents({"following_id": uid}),
        follows_collection.count_documents({"follower_id":  uid}),
        recipes_collection.count_documents({"user_id": user["_id"], "is_public": True, "is_modified": {"$ne": True}, "original_recipe_id": None}),
    )
    return {
        "id": uid,
        "name": user.get("name"),
        "email": user.get("email"),
        "follower_count":      follower_count,
        "following_count":     following_count,
        "public_recipe_count": recipe_count,
    }
