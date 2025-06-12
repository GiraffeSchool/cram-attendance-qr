import crypto from 'crypto';
import axios from 'axios';

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_REPLY_API = 'https://api.line.me/v2/bot/message/reply';

function validateLineSignature(body, signature) {
  if (!LINE_CHANNEL_SECRET || !signature) return false;
  const hash = crypto
    .createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(JSON.stringify(body))
    .digest('base64');
  return hash === signature;
}

async function replyMessage(replyToken, messages) {
  try {
    await axios.post(
      LINE_REPLY_API,
      { replyToken, messages },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }
    );
    console.log('訊息回覆成功');
  } catch (error) {
    console.error('回覆訊息失敗:', error.response?.data || error.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const signature = req.headers['x-line-signature'];
  // Vercel 已自動 parse JSON，body 會是 object
  if (!validateLineSignature(req.body, signature)) {
    console.log('簽名驗證失敗');
    return res.status(403).json({ error: 'Invalid signature' });
  }

  const events = req.body.events || [];
  for (const event of events) {
    // 處理加好友事件 - 自動回傳 User ID
    if (event.type === 'follow') {
      const userId = event.source.userId;
      const replyToken = event.replyToken;

      console.log('新用戶加入:', userId);

      // 自動回傳 User ID 給家長
      await replyMessage(replyToken, [
        {
          type: 'text',
          text: `歡迎加入育名補習班點名通知系統！\n\n您的 LINE User ID 是：\n${userId}\n\n請將此 ID 提供給補習班老師，以便設定簽到通知。`,
        },
        {
          type: 'text',
          text: '請將上面的 ID 提供給補習班老師進行設定。\n\n設定完成後，當您的孩子簽到時，您將會在此收到通知。',
        },
      ]);
    }

    // 處理文字訊息 - 不回應任何訊息
    if (event.type === 'message' && event.message.type === 'text') {
      const userId = event.source.userId;
      const text = event.message.text.trim();

      console.log(`💬 收到訊息: "${text}" from ${userId}`);
      console.log('（不回應一般訊息，User ID 已在加好友時提供）');
    }
  }
  res.json({ success: true });
}
