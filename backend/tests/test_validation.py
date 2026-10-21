from app.validation.page import validate_page

GOOD = "<!DOCTYPE html><html><body><p>课堂页面</p></body></html>"


def test_accepts_a_self_contained_page_and_does_not_rewrite_it():
    page = [{"path": "index.html", "content": GOOD, "media_type": "text/html"}]
    result = validate_page(page)

    assert result.ok is True
    assert result.errors == []
    assert page[0]["content"] == GOOD


def test_accepts_inline_style_script_and_a_relative_script():
    page = [
        {
            "path": "index.html",
            "content": (
                "<!DOCTYPE html><html><head><style>body{color:#111}</style></head>"
                "<body><p>课堂页面</p><script src=\"app.js\"></script></body></html>"
            ),
            "media_type": "text/html",
        },
        {"path": "app.js", "content": "console.log(1)", "media_type": "text/javascript"},
    ]

    assert validate_page(page).ok is True


def test_rejects_a_missing_or_duplicate_entry():
    missing = validate_page(
        [{"path": "app.js", "content": "console.log(1)", "media_type": "text/javascript"}]
    )
    duplicate = validate_page(
        [
            {"path": "index.html", "content": GOOD, "media_type": "text/html"},
            {"path": "nested/index.html", "content": GOOD, "media_type": "text/html"},
        ]
    )

    assert missing.ok is False
    assert duplicate.ok is False


def test_rejects_unsafe_paths_and_unknown_media_types():
    unsafe = validate_page([{"path": "../index.html", "content": GOOD, "media_type": "text/html"}])
    slashed = validate_page([{"path": "css\\app.css", "content": "body{}", "media_type": "text/css"}])
    mismatched = validate_page([{"path": "index.html", "content": GOOD, "media_type": "image/png"}])

    assert unsafe.ok is False
    assert slashed.ok is False
    assert mismatched.ok is False


def test_rejects_external_resources_server_code_and_empty_body():
    external = validate_page(
        [
            {
                "path": "index.html",
                "content": GOOD.replace("</body>", '<script src="https://cdn.example/a.js"></script></body>'),
                "media_type": "text/html",
            }
        ]
    )
    stylesheet = validate_page(
        [
            {
                "path": "index.html",
                "content": GOOD.replace(
                    "</body>",
                    '<link rel="stylesheet" href="https://cdn.example/a.css"></body>',
                ),
                "media_type": "text/html",
            }
        ]
    )
    server = validate_page(
        [{"path": "index.html", "content": GOOD.replace("<p>", "<?php echo 1; ?><p>"), "media_type": "text/html"}]
    )
    empty = validate_page(
        [
            {
                "path": "index.html",
                "content": "<!DOCTYPE html><html><body><script>1</script></body></html>",
                "media_type": "text/html",
            }
        ]
    )

    assert external.ok is False
    assert stylesheet.ok is False
    assert server.ok is False
    assert empty.ok is False


def test_rejects_an_oversized_file():
    html = "<!DOCTYPE html><html><body><p>" + ("字" * 200_000) + "</p></body></html>"
    result = validate_page([{"path": "index.html", "content": html, "media_type": "text/html"}])

    assert result.ok is False


def test_rejects_an_empty_file_list():
    assert validate_page([]).ok is False
