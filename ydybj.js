/*
 * 有道云笔记 每日签到
 * 
 * 青龙面板环境变量配置：
 * 变量名：YOUDAO_COOKIE
 * 变量值：你的Cookie字符串（多账号用 & 或换行分隔）
 * 
 * 获取Cookie方式：
 * 登录 https://note.youdao.com 后，F12打开控制台
 * Network标签页中找到任意请求，复制Request Headers中的Cookie值
 * 
 * 定时建议：0 8 * * *（每天早上8点）
 */

const axios = require("axios");

// ─── 读取环境变量 ────────────────────────────────────────────────
const YOUDAO_COOKIE = process.env.YOUDAO_COOKIE || "";

if (!YOUDAO_COOKIE) {
  console.log("❌ 未设置环境变量 YOUDAO_COOKIE，请在青龙面板中添加该变量");
  process.exit(1);
}

// 支持多账号，用 & 或换行分隔
const cookieList = YOUDAO_COOKIE.split(/\n|&/).map(s => s.trim()).filter(Boolean);
console.log(`共检测到 ${cookieList.length} 个账号\n${"=".repeat(40)}`);

// ─── 工具函数 ────────────────────────────────────────────────────

/**
 * 将 Cookie 字符串解析为对象
 */
function parseCookie(cookieStr) {
  const obj = {};
  cookieStr.split(";").forEach(part => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) obj[key] = val;
  });
  return obj;
}

/**
 * 将 Cookie 对象序列化为请求头字符串
 */
function serializeCookie(cookieObj) {
  return Object.entries(cookieObj)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/**
 * 从响应头 set-cookie 合并新 Cookie 到已有 Cookie 对象
 */
function mergeCookies(base, setCookieHeaders) {
  if (!setCookieHeaders) return base;
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  headers.forEach(header => {
    const pair = header.split(";")[0];
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) base[key] = val;
  });
  return base;
}

/**
 * 从 YNOTE_PERS 中提取 UID
 */
function extractUid(cookieObj) {
  try {
    const ynotePers = cookieObj["YNOTE_PERS"] || "";
    const parts = ynotePers.split("||");
    return parts[parts.length - 2] || "未获取到";
  } catch {
    return "未获取到";
  }
}

// ─── 签到核心逻辑 ────────────────────────────────────────────────

async function checkIn(cookieStr, accountIndex) {
  let cookieObj = parseCookie(cookieStr);
  const uid = extractUid(cookieObj);
  console.log(`\n【账号 ${accountIndex}】UID: ${uid}`);

  // Step 1: 刷新 Session
  try {
    const refreshRes = await axios.get(
      "http://note.youdao.com/login/acc/pe/getsess?product=YNOTE",
      {
        headers: { Cookie: serializeCookie(cookieObj) },
        maxRedirects: 5,
      }
    );
    cookieObj = mergeCookies(cookieObj, refreshRes.headers["set-cookie"]);
    console.log("✅ Session 刷新成功");
  } catch (e) {
    console.log(`⚠️  Session 刷新失败: ${e.message}`);
  }

  const cookieHeader = serializeCookie(cookieObj);

  // Step 2: daupromotion sync（判断是否可签到并获取同步奖励）
  let syncSpace = 0;
  let canCheckin = false;
  try {
    const syncRes = await axios.post(
      "https://note.youdao.com/yws/api/daupromotion?method=sync",
      null,
      { headers: { Cookie: cookieHeader } }
    );
    const syncData = syncRes.data;

    if (syncData && syncData.error) {
      console.log(`❌ Cookie 可能已过期，错误信息: ${JSON.stringify(syncData.error)}`);
      return;
    }

    if (syncData && syncData.rewardSpace !== undefined) {
      canCheckin = true;
      syncSpace = Math.floor(syncData.rewardSpace / 1048576);
      console.log(`📦 同步奖励空间: +${syncSpace}M`);
    } else {
      console.log("ℹ️  今日同步奖励不可用或已领取");
    }
  } catch (e) {
    if (e.response && e.response.status === 401) {
      console.log("❌ Cookie 已过期，请重新获取");
      return;
    }
    console.log(`⚠️  daupromotion 请求失败: ${e.message}`);
  }

  // Step 3: 签到
  let checkinSpace = 0;
  try {
    const checkinRes = await axios.post(
      "https://note.youdao.com/yws/mapi/user?method=checkin",
      null,
      { headers: { Cookie: cookieHeader } }
    );
    const checkinData = checkinRes.data;
    if (checkinData && checkinData.space !== undefined) {
      checkinSpace = Math.floor(checkinData.space / 1048576);
      console.log(`📅 签到奖励空间: +${checkinSpace}M`);
    } else {
      console.log("ℹ️  签到结果: " + JSON.stringify(checkinData));
    }
  } catch (e) {
    console.log(`⚠️  签到请求失败: ${e.message}`);
  }

  // Step 4: 广告奖励（连续请求3次）
  let adSpace = 0;
  for (let i = 0; i < 3; i++) {
    try {
      const adRes = await axios.post(
        "https://note.youdao.com/yws/mapi/user?method=adRandomPrompt",
        null,
        { headers: { Cookie: cookieHeader } }
      );
      const adData = adRes.data;
      const gained = Math.floor((adData?.space || 0) / 1048576);
      adSpace += gained;
      console.log(`📺 广告奖励 ${i + 1}/3: +${gained}M`);
    } catch (e) {
      console.log(`⚠️  广告奖励 ${i + 1}/3 失败: ${e.message}`);
    }
    // 小延迟，避免请求过快
    await new Promise(r => setTimeout(r, 500));
  }

  // 汇总
  const total = syncSpace + checkinSpace + adSpace;
  console.log(`\n🎉 账号 ${accountIndex} 本次共获得: +${total}M 空间`);
  console.log("=".repeat(40));
}

// ─── 主入口 ──────────────────────────────────────────────────────

async function main() {
  for (let i = 0; i < cookieList.length; i++) {
    await checkIn(cookieList[i], i + 1);
    if (i < cookieList.length - 1) {
      // 多账号之间间隔2秒
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.log("\n✅ 所有账号执行完毕");
}

main().catch(err => {
  console.error("脚本执行出错:", err.message);
  process.exit(1);
});
