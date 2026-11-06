"""One-time migration: lowercase and trim stored user emails.

Dry run by default (prints what would change). Pass --apply to write.
Accounts whose normalized email collides with another account are left
unchanged and reported, for manual resolution.

Run from backend/:  python migrate_emails.py [--apply]
"""
import asyncio
import re
import sys

from database import users_collection
from routers.users import normalize_email


async def main(apply: bool):
    changed = collisions = 0
    async for user in users_collection.find({}, {"email": 1}):
        stored = user.get("email")
        if not isinstance(stored, str):
            continue
        target = normalize_email(stored)
        if target == stored:
            continue
        clash = await users_collection.find_one({
            "_id": {"$ne": user["_id"]},
            "email": {"$regex": f"^{re.escape(target)}$", "$options": "i"},
        })
        if clash:
            collisions += 1
            print(f"COLLISION {user['_id']} {stored!r} matches {clash['_id']}; skipped")
            continue
        changed += 1
        print(f"{'UPDATE' if apply else 'WOULD UPDATE'} {user['_id']} {stored!r} -> {target!r}")
        if apply:
            await users_collection.update_one({"_id": user["_id"]}, {"$set": {"email": target}})
    print(f"{changed} to update, {collisions} collisions" + ("" if apply else " (dry run, pass --apply to write)"))


if __name__ == "__main__":
    asyncio.run(main(apply="--apply" in sys.argv[1:]))
