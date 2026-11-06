def make_list(client, uid):
    items = [{"name": "milk", "quantity": "1", "unit": "l", "category": "Dairy"},
             {"name": "eggs", "quantity": "12", "unit": "", "category": "Dairy"}]
    r = client.post("/groceryList/", json={"user_id": uid, "name": "Weekly", "items": items})
    assert r.status_code == 200, r.text
    return r.json()


def test_create_and_fetch_list(client, user):
    uid, _ = user
    created = make_list(client, uid)
    r = client.get(f"/groceryList/userID/{uid}")
    assert r.status_code == 200
    assert [l["name"] for l in r.json()] == ["Weekly"]
    assert len(created["items"]) == 2


def test_check_and_delete_item_by_id(client, user):
    uid, _ = user
    lst = make_list(client, uid)
    item = lst["items"][0]
    r = client.patch(f"/groceryList/{lst['_id'] if '_id' in lst else lst['id']}/items/{item['id']}/check")
    assert r.status_code == 200 and r.json()["checked"] is True
    lid = lst.get("_id") or lst.get("id")
    assert client.delete(f"/groceryList/{lid}/items/{item['id']}").status_code == 200
    left = client.get(f"/groceryList/listID/{lid}").json()["items"]
    assert [i["name"] for i in left] == ["eggs"]
