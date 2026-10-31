"""目标树 API：鉴权、属主隔离、层级校验、模板预填。"""

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def _client(tmp_path):
    return TestClient(create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=_idle))


def _idle(messages, tools):
    from app.llm.protocol import AssistantMessage

    return AssistantMessage(content="好", tool_calls=[])


def _register(client, username="teacher-a"):
    response = client.post(
        "/api/auth/register",
        json={"username": username, "password": "password123", "display_name": username},
    )
    assert response.status_code == 201
    return response.json()


def _create_tree(client, **overrides):
    body = {"subject": "数学", "grade": 7, "term": "上", "title": "七上数学"}
    body.update(overrides)
    return client.post("/api/goal-trees", json=body)


def test_goal_routes_require_login(tmp_path):
    client = _client(tmp_path)
    assert client.get("/api/goal-trees").status_code == 401
    assert client.post("/api/goal-trees", json={}).status_code == 401


def test_create_list_get_tree(tmp_path):
    client = _client(tmp_path)
    _register(client)

    created = _create_tree(client)
    assert created.status_code == 201
    tree = created.json()
    assert tree["subject"] == "数学" and tree["title"] == "七上数学"

    listed = client.get("/api/goal-trees", params={"subject": "数学"}).json()["trees"]
    assert [t["tree_id"] for t in listed] == [tree["tree_id"]]

    detail = client.get(f"/api/goal-trees/{tree['tree_id']}")
    assert detail.status_code == 200
    assert detail.json()["nodes"] == []


def test_list_trees_filters_by_grade(tmp_path):
    client = _client(tmp_path)
    _register(client)
    tree = _create_tree(client).json()
    _create_tree(client, grade=8, title="八上数学")

    listed = client.get("/api/goal-trees", params={"grade": 7}).json()["trees"]
    assert [t["tree_id"] for t in listed] == [tree["tree_id"]]


def test_list_trees_rejects_bad_grade_filter(tmp_path):
    client = _client(tmp_path)
    _register(client)
    for bad in ("abc", ""):
        response = client.get("/api/goal-trees", params={"grade": bad})
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "invalid_input"


def test_create_tree_rejects_bad_dimensions(tmp_path):
    client = _client(tmp_path)
    _register(client)
    assert _create_tree(client, subject="书法").status_code == 400
    assert _create_tree(client, grade=10).status_code == 400
    assert _create_tree(client, term="全学年").status_code == 400
    assert _create_tree(client, title="  ").status_code == 400


def test_template_init_prefills_semester_nodes(tmp_path):
    client = _client(tmp_path)
    _register(client)
    tree = _create_tree(client, template_init=True).json()
    nodes = client.get(f"/api/goal-trees/{tree['tree_id']}").json()["nodes"]
    assert len(nodes) >= 3
    assert all(n["level"] == "semester" for n in nodes)


def test_owner_isolation_returns_404(tmp_path):
    client = _client(tmp_path)
    _register(client, "teacher-a")
    tree = _create_tree(client).json()
    client.post("/api/auth/logout")

    _register(client, "teacher-b")
    assert client.get(f"/api/goal-trees/{tree['tree_id']}").status_code == 404
    assert client.patch(f"/api/goal-trees/{tree['tree_id']}", json={"title": "x"}).status_code == 404
    assert client.delete(f"/api/goal-trees/{tree['tree_id']}").status_code == 404
    assert (
        client.post(
            f"/api/goal-trees/{tree['tree_id']}/nodes",
            json={"parent_id": None, "level": "unit", "title": "x", "description": "", "verify_criteria": "", "standard_refs": []},
        ).status_code
        == 404
    )


def test_node_owner_isolation_returns_404(tmp_path):
    client = _client(tmp_path)
    _register(client, "teacher-a")
    tree = _create_tree(client).json()
    node = client.post(
        f"/api/goal-trees/{tree['tree_id']}/nodes",
        json={"parent_id": None, "level": "unit", "title": "第一单元"},
    ).json()
    client.post("/api/auth/logout")

    _register(client, "teacher-b")
    patched = client.patch(f"/api/goal-nodes/{node['node_id']}", json={"title": "x"})
    assert patched.status_code == 404
    assert patched.json()["error"]["code"] == "not_found"
    deleted = client.delete(f"/api/goal-nodes/{node['node_id']}")
    assert deleted.status_code == 404
    assert deleted.json()["error"]["code"] == "not_found"


def test_node_crud_and_hierarchy_errors(tmp_path):
    client = _client(tmp_path)
    _register(client)
    tree = _create_tree(client).json()

    def make_node(**overrides):
        body = {
            "parent_id": None, "level": "unit", "title": "第一单元",
            "description": "d", "verify_criteria": "c", "standard_refs": ["数与代数"],
        }
        body.update(overrides)
        return client.post(f"/api/goal-trees/{tree['tree_id']}/nodes", json=body)

    unit = make_node().json()
    assert unit["level"] == "unit" and unit["standard_refs"] == ["数与代数"]

    lesson = make_node(parent_id=unit["node_id"], level="lesson", title="第 1 课时").json()
    assert lesson["parent_id"] == unit["node_id"]

    assert make_node(parent_id=None, level="lesson").status_code == 400
    assert make_node(parent_id=unit["node_id"], level="semester").status_code == 400
    assert make_node(parent_id="0" * 32, level="lesson").status_code == 404

    patched = client.patch(
        f"/api/goal-nodes/{lesson['node_id']}",
        json={"title": "第 1 课时：有理数", "description": "新", "verify_criteria": "新", "standard_refs": []},
    )
    assert patched.status_code == 200 and patched.json()["title"] == "第 1 课时：有理数"

    # 重排：边界处静默成功（unit 是唯一的根级单元，处于排序边界）
    assert client.post(f"/api/goal-nodes/{unit['node_id']}/reorder", json={"direction": "up"}).status_code == 200
    assert client.post(f"/api/goal-nodes/{unit['node_id']}/reorder", json={"direction": "跳"}).status_code == 400

    # 有子节点 → 409
    assert client.delete(f"/api/goal-nodes/{unit['node_id']}").status_code == 409
    assert client.delete(f"/api/goal-nodes/{lesson['node_id']}").status_code == 204
    assert client.delete(f"/api/goal-nodes/{unit['node_id']}").status_code == 204


def test_rename_and_delete_tree(tmp_path):
    client = _client(tmp_path)
    _register(client)
    tree = _create_tree(client).json()
    renamed = client.patch(f"/api/goal-trees/{tree['tree_id']}", json={"title": "七上数学-草稿"})
    assert renamed.status_code == 200 and renamed.json()["title"] == "七上数学-草稿"
    assert client.delete(f"/api/goal-trees/{tree['tree_id']}").status_code == 204
    assert client.get(f"/api/goal-trees/{tree['tree_id']}").status_code == 404
