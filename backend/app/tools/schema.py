"""参数 JSON Schema 的最小校验。"""


def argument_errors(schema: dict, arguments: object) -> list[str]:
    if not isinstance(arguments, dict):
        return ["参数必须是对象。"]
    properties = schema.get("properties", {})
    errors: list[str] = []
    if schema.get("additionalProperties") is False:
        unknown = sorted(set(arguments) - set(properties))
        if unknown:
            errors.append("不能包含未声明的参数：" + "、".join(unknown) + "。")
    for name in schema.get("required", []):
        if name not in arguments:
            errors.append(f"缺少参数 {name}。")
    for name, value in arguments.items():
        prop = properties.get(name)
        if prop is not None:
            errors.extend(_check(name, prop, value))
    return errors


def _check(name: str, prop: dict, value: object) -> list[str]:
    kind = prop.get("type")
    if kind == "string":
        if not isinstance(value, str):
            return [f"{name} 必须是字符串。"]
        if "enum" in prop and value not in prop["enum"]:
            return [f"{name} 不在允许的取值里。"]
        minimum = prop.get("minLength")
        maximum = prop.get("maxLength")
        if isinstance(minimum, int) and len(value) < minimum:
            return [f"{name} 太短。"]
        if isinstance(maximum, int) and len(value) > maximum:
            return [f"{name} 太长。"]
        return []
    if kind == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            return [f"{name} 必须是整数。"]
        return []
    if kind == "array":
        if not isinstance(value, list):
            return [f"{name} 必须是数组。"]
        item_schema = prop.get("items", {})
        errors: list[str] = []
        for item in value:
            errors.extend(_check(name, item_schema, item))
        return errors
    return [f"{name} 的类型无法校验。"]
