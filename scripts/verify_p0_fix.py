#!/usr/bin/env python3
"""P0-3 知识桥梁 + P0-5 真会vs看过 的端到端验证"""
import json, time, urllib.request

BASE = "http://localhost:8787"

def post(path, data):
    req = urllib.request.Request(BASE + path, data=json.dumps(data).encode(), headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=180))

def get(path):
    return json.load(urllib.request.urlopen(BASE + path, timeout=60))

print("=" * 60)
print("P0-3 验证：录入新知识，观察 bridge 是否转存为 gap（而非关系边）")
print("=" * 60)

# 录入一条可能与已有知识形成「桥梁」的知识：注意力机制
k = post("/api/cocreation/confirm", {"draft": {
    "title": "自注意力机制的作用",
    "coreConclusion": "自注意力机制让模型能直接计算序列中任意两个位置的关系，是Transformer的核心组件。",
    "detailExplanation": "自注意力通过Q/K/V计算，让每个位置都能直接关注到其他位置，从而捕捉长距离依赖。",
    "type": "概念", "tags": ["注意力", "Transformer"]
}, "sourceType": "自己总结"})
print("新知识 id:", k.get("id"))
print("标题:", k.get("title"))

time.sleep(3)

# 检查图谱边里是否有 bridge 类型
graph = get("/api/graph")
bridge_edges = [e for e in graph["edges"] if e.get("type") == "bridge"]
print(f"\n图谱边总数: {len(graph['edges'])}, 其中 bridge 边: {len(bridge_edges)}")
if bridge_edges:
    print("❌ 仍有 bridge 关系边（未转存）")
else:
    print("✅ 图谱中无 bridge 关系边（bridge 已从关系边中移除）")

# 检查 KnowledgeGap 表是否新增（通过断层接口）
try:
    gaps = get("/api/gaps")
    print(f"当前断层记录数: {len(gaps)}")
    for g in gaps[-5:]:
        print(f"  - {g.get('gapDescription','')[:50]} | from:{bool(g.get('fromKnowledgeId'))} to:{bool(g.get('toKnowledgeId'))}")
except Exception as e:
    print("断层接口:", e)

print()
print("=" * 60)
print("P0-5 验证：答错（概念混淆）后，下一题是否出辨析题")
print("=" * 60)

# 拿一条已有知识做复习
ks = get("/api/knowledge")
if not ks:
    print("无知识可测，结束")
    raise SystemExit(0)
target = ks[0]["id"]
print("复习知识:", ks[0]["title"])

# Session A：第一次复习，出第一题
s1 = post("/api/review/session", {"knowledgeIds": [target], "type": "mixed"})
sid = s1["sessionId"]
q1 = get(f"/api/review/session/{sid}/next")
print("\n[Session A] 第一题题型:", q1.get("type"), "| 难度:", q1.get("difficulty"))
print("  题目:", (q1.get("prompt") or "")[:80])

# 提交一个「概念混淆」的答案（故意把概念说反，诱导 AI 判 confusion）
confusing_answer = "我不太确定，但我觉得自注意力和卷积是一回事，都是滑动窗口去扫图像，所以ViT本质上还是CNN。"
print("\n提交混淆答案...")
a1 = post(f"/api/review/question/{q1['questionId']}/answer", {"answer": confusing_answer})
print("  isCorrect:", a1.get("isCorrect"), "| score:", a1.get("score"))
print("  errorType:", a1.get("errorType"))

# Session B：再次复习同一条知识，看题型是否根据 errorType 变化
print("\n开启 Session B 复习同一条知识...")
s2 = post("/api/review/session", {"knowledgeIds": [target], "type": "mixed"})
sid2 = s2["sessionId"]
q2 = get(f"/api/review/session/{sid2}/next")
print("[Session B] 第一题题型:", q2.get("type"), "| 难度:", q2.get("difficulty"))
print("  题目:", (q2.get("prompt") or "")[:80])

if a1.get("errorType") == "confusion" and q2.get("type") == "counterexample":
    print("\n✅ errorType=confusion 正确驱动出 counterexample（辨析题）")
elif a1.get("errorType") == "confusion":
    print(f"\n⚠️ errorType=confusion 但下一题是 {q2.get('type')}（预期 counterexample）")
else:
    print(f"\n⚠️ AI 未判为 confusion（实际 errorType={a1.get('errorType')}），无法验证题型驱动，记录实际行为")

print("\n验证完成")
