#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""个人 AI 知识教练 · 端到端验收测试脚本（第二批）
覆盖：知识关联/桥梁、用户画像、知识断层、AI 问答、复习出题、掌握度评估
结果打印到 stdout，供验收记录。
"""
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
    return post("/api/cocreation/confirm", {"draft": draft, "sourceType": "自己总结"})


def hr(s):
    print("\n" + "=" * 70)
    print(s)
    print("=" * 70)


# 1. 批量录入 4 条相关知识（贴合销售场景，制造关系/桥梁/断层）
hr("准备数据：录入 4 条相关知识")
k1 = add_knowledge(
    "Transformer 是什么",
    "Transformer 是一种基于自注意力机制的神经网络架构，能一次性建模序列中所有位置之间的关系，是当前大语言模型的基础。",
    "Transformer 抛弃了循环结构，通过自注意力机制让每个位置都能直接关注到其他所有位置，从而高效捕捉全局依赖。它是 GPT、BERT 等大模型的核心架构。",
    "概念", ["Transformer", "大模型", "深度学习"])
print("知识1 id:", k1.get("id"), "| 分类:", k1.get("categoryId"))

k2 = add_knowledge(
    "大模型训练与推理需要大量算力",
    "Transformer 类大模型的训练和推理需要大量 GPU 算力，这是 AI 服务器需求的根本来源。",
    "大模型参数量动辄数十亿到数千亿，训练需要数千张 GPU 并行数月，推理也需要大量算力实时响应。因此 AI 服务器的 GPU 数量、显存和带宽直接决定客户能不能跑起来。",
    "因果", ["算力", "GPU", "AI服务器"])
print("知识2 id:", k2.get("id"), "| 分类:", k2.get("categoryId"))

k3 = add_knowledge(
    "AI 服务器是什么",
    "AI 服务器是搭载多张 GPU 加速卡、专门为 AI 训练和推理提供算力的服务器。",
    "AI 服务器相比普通服务器，重点强化了 GPU 卡的数量、显存容量、NVLink 互联带宽和散热能力，用来承载大模型的训练和推理任务。",
    "概念", ["AI服务器", "GPU", "硬件"])
print("知识3 id:", k3.get("id"), "| 分类:", k3.get("categoryId"))

k4 = add_knowledge(
    "GPU 显存与算力的关系",
    "GPU 显存大小决定能装下多大的模型，算力决定推理速度，两者共同影响 AI 服务器的配置和成本。",
    "模型参数要加载进显存才能运行，显存不够模型跑不起来；显存够但算力不足，推理会变慢。所以给客户配 AI 服务器时，要同时看显存和算力。",
    "概念", ["显存", "算力", "GPU"])
print("知识4 id:", k4.get("id"), "| 分类:", k4.get("categoryId"))

time.sleep(1)

# 2. 知识关系（图谱 + 单条关系）
hr("用例2：知识关系与图谱")
graph = get("/api/graph")
print("图谱节点数:", len(graph.get("nodes", [])), "| 边数:", len(graph.get("edges", [])))
for e in graph.get("edges", []):
    print(f"  边: {e.get('type')} | reason: {e.get('reason')}")

# 单条知识的关系
if k1.get("id"):
    rels = get(f"/api/knowledge/{k1.get('id')}/relations")
    print("知识1(Transformer) 的关系:")
    for r in rels:
        if isinstance(r, dict):
            print(f"  - {r.get('type')} -> {r.get('other', {}).get('title')} (reason: {r.get('reason')})")

# 3. 用户画像
hr("用例9：用户画像刷新")
prof = post("/api/profile/refresh", {})
if isinstance(prof, dict) and "_error" in prof:
    print("画像错误:", prof["_error"])
else:
    for field in ["occupation", "workDomain", "currentFocus", "technicalDepth", "businessLevel",
                  "primaryKnowledgeAreas", "deepDiveAreas", "shallowAreas", "learningGoals"]:
        v = prof.get(field)
        if v:
            print(f"  {field}: {v}")

# 4. 知识断层
hr("用例6：知识断层发现")
gaps = post("/api/gaps/discover", {})
if isinstance(gaps, list):
    print("断层数量:", len(gaps))
    for g in gaps:
        print(f"  - 缺失: {g.get('gapDescription')}")
        print(f"    recommended: {g.get('recommended')} | reason: {g.get('reason')}")
else:
    print("断层错误:", gaps)

# 5. AI 问答（知识调用）
hr("用例3：AI 问答 / 知识调用")
ask_resp = post("/api/ask", {"question": "客户要买 AI 服务器做推理，我该怎么帮他考虑显存和算力的配置？"})
if isinstance(ask_resp, dict) and "_error" in ask_resp:
    print("问答错误:", ask_resp["_error"])
else:
    print("--- AI 回答 ---")
    print(ask_resp.get("answer", "")[:1500])
    print("--- 召回的相关知识 ---")
    for r in ask_resp.get("related", []):
        print(f"  - {r.get('title')}")

# 6. 复习出题 + 掌握度
hr("用例4/5：复习出题与掌握度评估")
session = post("/api/review/session", {})
sid = session.get("sessionId")
print("复习会话 id:", sid, "| 题目数:", session.get("total"))

if sid:
    for i in range(3):  # 取 3 题观察
        q = get(f"/api/review/session/{sid}/next")
        if isinstance(q, dict) and q.get("done"):
            print(f"第{i+1}题：done（题目用完）")
            break
        if isinstance(q, dict) and "_error" in q:
            print(f"第{i+1}题：错误", q["_error"])
            break
        print(f"\n--- 第{i+1}题 ---")
        print(f"题型: {q.get('type')} | 难度: {q.get('difficulty')}")
        print(f"题目: {q.get('prompt')}")
        qid = q.get("questionId")
        # 提交一个"背下来了但可能不理解"的回答，测试评估
        ans = post(f"/api/review/question/{qid}/answer", {"answer": "Transformer 通过自注意力机制处理序列。"})
        if isinstance(ans, dict) and "_error" in ans:
            print("评估错误:", ans["_error"])
        else:
            print(f"评估 isCorrect: {ans.get('isCorrect')} | score: {ans.get('score')}")
            print(f"反馈: {ans.get('feedback')}")
            print(f"errorType: {ans.get('errorType')}")
        time.sleep(1)

print("\n" + "=" * 70)
print("第二批验收测试完成")
print("=" * 70)
