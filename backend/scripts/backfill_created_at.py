"""Backfill `created_at` on recipes that predate the field.

Run from backend/ with the venv active: `python -m scripts.backfill_created_at`
(uses the same MONGODB_URI / DATABASE_NAME env as backend/database.py).

Idempotent: only touches recipes missing `created_at`, deriving the timestamp
from the document's ObjectId generation time (a timezone-aware datetime).
"""
import asyncio

from database import recipes_collection


async def backfill():
    query = {"created_at": {"$exists": False}}
    updated = 0
    cursor = recipes_collection.find(query, {"_id": 1})
    async for doc in cursor:
        await recipes_collection.update_one(
            {"_id": doc["_id"]},
            {"$set": {"created_at": doc["_id"].generation_time}},
        )
        updated += 1
    print(f"Backfilled created_at on {updated} recipe(s).")


if __name__ == "__main__":
    asyncio.run(backfill())
