# 当前脚本来自于 http://script.345yun.cn 脚本库下载！

import requests
import json
import time
import sys
import os

#====请自行抓包后填写以下内容========#
# 抓取 https://shop-api.retail.mi.com/mtop/navi/venue/batch?page_id=13880&pdl=mishop 的请求部分的 cookies：
SERVICE_TOKEN = "xxxx"
# Actid，应该不用动,如需要，抓取https://shop-api.retail.mi.com/mtop/mf/act/infinite/do
ACT_ID = "6706c0695404a23dfb5b2cab"
# sign 自行抓取 https://shop-api.retail.mi.com/mtop/navi/venue/batch 的 query_list 里面的 sign
# 如遇报错：任务失败，invalid sign 就需要重新抓取
sign = "xxx"
#=====填写内容结束====#

#===整理cookie和请求头===#
cookie_str = f"serviceToken={SERVICE_TOKEN}; "

headers = {
    "x-user-agent": "channel/mishop platform/mishop.android",
    "Content-Type": "application/json",
    "User-Agent": "okhttp/3.12.3",
    "Cookie": cookie_str,
}
#===整理cookie和请求头结束===#


#====推送wxpuher====#

# 环境变量获取
WXPUSHER_APP_TOKEN = os.getenv("WXPUSHER_APP_TOKEN")
WXPUSHER_UIDS = os.getenv("WXPUSHER_UID", "").split("&")

def send_wxpusher(msg):
    if not WXPUSHER_APP_TOKEN or not WXPUSHER_UIDS:
        print("⚠️ 未配置 WxPusher，跳过推送")
        return

    url = "https://wxpusher.zjiecode.com/api/send/message"
    headers_ = {"Content-Type": "application/json"}
    for uid in WXPUSHER_UIDS:
        data = {
            "appToken": WXPUSHER_APP_TOKEN,
            "content": msg,
            "contentType": 3,  # Markdown
            "topicIds": [],
            "uids": [uid],
        }
        try:
            resp = requests.post(url, json=data, headers=headers_, timeout=10)
            if resp.json().get("code") == 1000:
                print(f"✅ 消息推送成功 -> UID: {uid}")
            else:
                print(f"❌ 推送失败：{resp.text}")
        except Exception as e:
            print(f"❌ 推送异常：{e}")

#====推送wxpusher结束===#

# 获取并整理任务列表
def get_tasks():
    url = "https://shop-api.retail.mi.com/mtop/navi/venue/batch?page_id=13880&pdl=mishop"
    payload = {
        "query_list": [
            {
                "resolver": "infinite-task",
                "sign": sign,
                "parameter": f'{{"actId":"{ACT_ID}","taskTypeList":[101,200,110,201,202]}}',
                "variable": {}
            }
        ]
    }
    tasks = []
    response = requests.post(url, headers=headers, json=payload)
    try:
        data = response.json()
    except Exception as e:
        return None, f"解析 JSON 失败: {e}"

    if data.get("message") != "ok":
        return None, f"获取任务列表失败：{data.get('message')}"

    comps = data.get("data", {}).get("result_list", [{}])[0].get("components", [])
    for comp in comps:
        if comp.get("canDo", True):
            tasks.append({
                "taskId": comp["taskId"],
                "taskName": comp.get("taskName", ""),
                "taskType": int(comp.get("taskType", 0))
            })
    return tasks, None


# 获取 taskToken
def get_task_token(task_id):
    do_url = "https://shop-api.retail.mi.com/mtop/mf/act/infinite/do"
    do_payload = [
        {},
        {
            "taskId": task_id,
            "actId": ACT_ID
        }
    ]
    resp = requests.post(do_url, headers=headers, data=json.dumps(do_payload))
    try:
        data = resp.json()
        return data["data"]["taskToken"]
    except:
        print(f"⚠️ 获取 token 失败：{resp.text}")
        return None

# 提交tasktoken，完成任务
def do_task(token, task_type):
    done_url = "https://shop-api.retail.mi.com/mtop/mf/act/infinite/done"
    done_payload = [
        {},
        {
            "taskToken": token,
            "actId": ACT_ID,
            "taskType": task_type
        }
    ]
    resp = requests.post(done_url, headers=headers, data=json.dumps(done_payload))
    try:
        return resp.json()
    except:
        return {"success": False, "msg": "done 请求异常", "raw": resp.text}

# 主程序
def main():
    print("\n=============== 小米商城任务开始 ===============")
    tasks, err = get_tasks()
    if err:
        print("⚠️", err)
        return

    print(f"共找到 {len(tasks)} 个可执行任务\n")

    results = []
    for task in tasks:
        tname = task["taskName"]
        tid = task["taskId"]
        ttype = task["taskType"]

        if ttype == 201:
            print(f"⏭️ 跳过任务（类型201，需支付）：{tname} (任务ID: {tid})\n")
            results.append((tname, "⏭️ 跳过（需支付）"))
            continue

        print(f"🔹 {tname} (任务ID: {tid})，类型: {ttype}")
        token = get_task_token(tid)
        if not token:
            print("❌ 获取 taskToken 失败\n")
            results.append((tname, "❌ 获取 taskToken 失败"))
            continue

        if ttype == 200:
            print("任务为浏览类，等待 3 秒...")
            time.sleep(3)

        r = do_task(token, ttype)
        if not r.get("success", False):
            print(f"❌ 执行失败：{r.get('msg', '未知错误')}\n")
            results.append((tname, f"❌ {r.get('msg', '未知错误')}"))
        else:
            awards = r.get("data", {}).get("awardList", [])
            if awards:
                award = awards[0]
                print(f"✅ 获得 {award.get('awardValue', '?')} {award.get('awardName', '')}\n")
                results.append((tname, f"✅ 获得 {award.get('awardValue', '?')} {award.get('awardName', '')}"))
            else:
                print("✅ 成功（无奖励）\n")
                results.append((tname, "✅ 成功（无奖励）"))

        time.sleep(1)

    # 生成表格推送
    table = "### 🛒 小米商城任务执行结果\n\n| 任务名称 | 执行结果 |\n|:-:|:-:|\n"
    for name, res in results:
        table += f"| {name} | {res} |\n"

    send_wxpusher(table)


if __name__ == "__main__":
    main()

 
