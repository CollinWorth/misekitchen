def test_signup_rejects_short_password(client):
    r = client.post("/users/", json={"name": "A", "email": "a@b.com", "password": "short"})
    assert r.status_code == 400


def test_duplicate_email_in_other_case_is_rejected(client, user):
    r = client.post("/users/", json={"name": "B", "email": "TEST@example.COM", "password": "password123"})
    assert r.status_code == 400


def test_login_ignores_email_case(client, user):
    r = client.post("/users/login", json={"email": "TEST@EXAMPLE.COM", "password": "password123"})
    assert r.status_code == 200


def test_wrong_password_is_401(client, user):
    r = client.post("/users/login", json={"email": "test@example.com", "password": "wrongpass1"})
    assert r.status_code == 401


def test_me_needs_a_token_and_returns_the_user(client, user):
    uid, headers = user
    assert client.get("/users/me").status_code in (401, 403)
    r = client.get("/users/me", headers=headers)
    assert r.status_code == 200 and r.json()["id"] == uid
