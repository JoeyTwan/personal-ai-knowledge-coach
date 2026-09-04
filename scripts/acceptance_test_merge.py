#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第三批：知识合并 + 知识演化 验收测试"""
import json
import urllib.request
import urllib.error
import time

BASE = "http://localhost:8787"


def post(path, data, timeout=180):
    body = json.dumps(data).encode()
    req = urllib.request.Request(BASE + path, data=body, headers={"Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=timeout))
    except urllib.error.HTTPError as e:
        return {"_error": e.read().decode()[:600]}


def get(path, timeout=60):
    try:
        return json.load(urllib.request.urlopen(BASE + path, timeout=timeout))
    except urllib.error.HTTPError as e:
        return {"_error": e.read().decode()[:600]}


def add_knowledge(title, core, detail, typ, tags):
    draft = {"title": title, "coreConclusion": core, "detailExplanation": detail,
             "type": typ, "tags": tags}
    return post("/api/cocreation/confirm", {"draft": draft, "sourceType": "客户交流"})


def hr(s):
    print("\n" + "=" * 70)
    print(s)
    print("=" * 70)


# 场景：模拟需求第12条案例E —— 同一主题信息随时间演化
hr("准备：录入 3 条「某厂商液冷能力」的递进信息（模拟 7/8/9 月）")
e1 = add_knowledge(
    "某厂商具备液冷能力",
    "2026年7月：初步听闻某厂商具备液冷散热能力。",
    "在一次行业交流中听说某厂商在布局液冷，可信度一般，尚未验证。",
    "公司信息", ["液冷", "散热"])
print("录入1 id:", e1.get("id"), "| 标题:", e1.get("title"))

e2 = add_knowledge(
    "某厂商的液冷能力",
    "2026年8月：获得客户反馈，某厂商确实在做液冷。",
    "客户提到该厂商的液冷方案已在接触中，可信度提升。",
    "公司信息", ["液冷", "散热"])
print("录入2 id:", e2.get("id"), "| 标题:", e2.get("title"))

e3 = add_knowledge(
    "某厂商液冷项目",
    "2026年9月：某厂商液冷能力在项目中得到验证。",
    "自己的项目里验证了该厂商的液冷方案可用，可信度很高。",
    "公司信息", ["液冷", "散热"])
print("录入3 id:", e3.get("id"), "| 标题:", e3.get("title"))

time.sleep(1)

# 检查是否生成了 3 条独立知识（演化是否生效）
hr("检查：3 条液冷知识是否被识别为「同一条知识的演化」还是「3条独立知识」")
lst = get("/api/knowledge")
liquid = [k for k in lst if "液冷" in (k.get("title", "") + k.get("coreConclusion", ""))]
print(f"液冷相关知识条数: {len(liquid)}")
for k in liquid:
    print(f"  - [{k.get('status')}] {k.get('title')}")
print(">> 若为 3 条 active，说明「知识演化」未生效（需求案例E 失败）")

# 知识合并：重复检测
hr("用例7：知识合并 · 重复检测")
dup = post("/api/merge/detect", {})
print("重复检测结果:", json.dumps(dup, ensure_ascii=False, indent=2)[:1200])

# 若有重复，执行合并
if isinstance(dup, list) and len(dup) > 0:
    ids = dup[0].get("knowledgeIds", [])
    hr("用例7：执行合并")
    merged = post("/api/merge", {"knowledgeIds": ids})
    if isinstance(merged, dict) and "_error" in merged:
        print("合并错误:", merged["_error"])
    else:
        print("合并后新知识 id:", merged.get("id"), "| 标题:", merged.get("title"))
        print("合并后核心结论:", merged.get("coreConclusion"))
        # 检查旧知识是否归档
        lst2 = get("/api/knowledge")
        liquid2 = [k for k in lst2 if "液冷" in (k.get("title", "") + k.get("coreConclusion", ""))]
        for k in liquid2:
            print(f"  合并后: [{k.get('status')}] {k.get('title')}")

print("\n" + "=" * 70)
print("第三批验收测试完成")
print("=" * 70)
