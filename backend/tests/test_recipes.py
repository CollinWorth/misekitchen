# The Recipe model requires user_id in the body; the endpoint then overrides it from the token.
RECIPE = {"recipe_name": "Pancakes", "instructions": "Mix and fry.",
          "ingredients": [{"name": "flour", "quantity": "1", "unit": "cup"}]}


def test_create_requires_login(client):
    assert client.post("/recipes/", json=RECIPE).status_code in (401, 403)


def test_create_and_read_back(client, user):
    uid, headers = user
    r = client.post("/recipes/", json={**RECIPE, "user_id": uid}, headers=headers)
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    got = client.get(f"/recipes/{rid}", headers=headers)
    assert got.status_code == 200 and got.json()["recipe_name"] == "Pancakes"


def test_bad_recipe_id_is_400_not_500(client, user):
    _, headers = user
    assert client.get("/recipes/not-an-id", headers=headers).status_code == 400
