import { google } from 'googleapis';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import axios from 'axios';

dayjs.extend(utc);
dayjs.extend(timezone);

// Google Sheets 設定
const SHEET_IDS = [
  '1SOTkqaIN3g4Spk0Cri4F1mEzdiD1xvLzR5x5KLmhrmY', // 國中
  '14k7fkfiPdhrSnYPXLJ7--8s_Qk3wehI0AZDpgFw83AM', // 先修
  '1c7zuwUaz-gzY0hbDDO2coixOcQLGhbZbdUXZ9X63Wfo', // 兒美
];

// 解析 Google 憑證
const getGoogleAuth = () => {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT)
    : require('../credentials.json');

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
};

// ===== LINE 推送訊息（簽到通知用）=====
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_PUSH_API = 'https://api.line.me/v2/bot/message/push';

async function pushMessage(to, messages) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !to) {
    console.log('無法發送 LINE 通知：缺少 token 或收件者');
    return;
  }
  try {
    await axios.post(
      LINE_PUSH_API,
      { to, messages },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }
    );
    console.log('LINE 通知發送成功');
  } catch (error) {
    console.error('推送訊息失敗:', error.response?.data || error.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed');
  }

  // === 以下完整保留你的原始 GET /attend 處理邏輯 ===
  try {
    const token = req.query.token;
    if (!token) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>錯誤</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
            h2 { color: #dc3545; }
          </style>
        </head>
        <body>
          <h2>❌ 缺少簽到代碼</h2>
          <p>請使用正確的 QR Code 掃描</p>
        </body>
        </html>
      `);
    }

    const studentId = Buffer.from(token, 'base64').toString('utf-8').trim();
    const now = dayjs().tz('Asia/Taipei');
    const today = now.format('YYYY-MM-DD');
    const time = now.format('HH:mm');
    const datetime = now.format('YYYY/MM/DD HH:mm');

    console.log('學號:', studentId);
    console.log('今天日期:', today);
    console.log('簽到時間:', time);

    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // 遍歷所有試算表
    for (const sheetId of SHEET_IDS) {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      const sheetTitle = meta.data.sheets[0].properties.title;

      const resData = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${sheetTitle}!A1:Z1000`,
      });

      if (!resData.data.values || resData.data.values.length === 0) {
        console.log(`${sheetTitle} 沒有資料，跳過`);
        continue;
      }

      const [header, ...rows] = resData.data.values;
      const idCol = header.indexOf('學號');
      const dateCol = header.indexOf(today);
      const nameCol = header.indexOf('姓名');
      const classCol = header.indexOf('班級');
      const parentLineCol = header.findIndex(
        (h) =>
          h &&
          (h.includes('家長LINE') ||
            h.includes('家長Line') ||
            h.includes('家長line') ||
            h === 'LINE')
      );

      console.log(`\n檢查 ${sheetTitle}:`);
      console.log('  學號欄位索引:', idCol);
      console.log('  日期欄位索引:', dateCol);
      console.log('  家長LINE欄位索引:', parentLineCol);

      if (idCol === -1) {
        console.log('  ❌ 找不到學號欄位');
        continue;
      }

      if (dateCol === -1) {
        console.log('  ❌ 找不到今天的日期欄位:', today);
        continue;
      }

      // 尋找學生
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if ((row[idCol] || '').trim() === studentId) {
          console.log('  ✅ 找到學生！在第', i + 2, '行');

          const rowNumber = i + 2;
          const colLetter = String.fromCharCode(65 + dateCol);
          const cell = `${colLetter}${rowNumber}`;

          // 檢查是否已經簽到
          const currentValue = row[dateCol] || '';
          if (currentValue.includes('出席')) {
            console.log('  ⚠️ 該學生已經簽到過了');
            return res.send(`
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>已簽到</title>
                <style>
                  body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
                  h2 { color: #ffc107; }
                  .info { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
                </style>
              </head>
              <body>
                <h2>⚠️ 你已經簽到過了</h2>
                <div class="info">
                  <p>原簽到記錄：${currentValue}</p>
                </div>
              </body>
              </html>
            `);
          }

          // 更新簽到狀態
          await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: `${sheetTitle}!${cell}`,
            valueInputOption: 'USER_ENTERED',
            resource: {
              values: [[`出席 ${time}`]],
            },
          });

          console.log('  ✅ 簽到成功！');

          // 取得學生資訊
          const studentName = nameCol !== -1 ? row[nameCol] : '';
          const className = classCol !== -1 ? row[classCol] : sheetTitle;
          const parentLineId = parentLineCol !== -1 ? row[parentLineCol] : null;

          // 發送 LINE 通知給家長
          if (parentLineId && LINE_CHANNEL_ACCESS_TOKEN) {
            console.log('  📱 發送 LINE 通知給家長...');
            await pushMessage(parentLineId, [
              {
                type: 'text',
                text: `【簽到通知】\n您的孩子 ${studentName} 已於 ${datetime} 完成簽到。\n班級：${className}\n\n祝學習愉快！`,
              },
            ]);
          }

          return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>簽到成功</title>
              <style>
                body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
                h2 { color: #28a745; }
                .success { background: #d4edda; color: #155724; padding: 15px; border-radius: 5px; margin: 20px 0; }
                .info { margin-top: 20px; }
                .info p { margin: 5px 0; }
              </style>
            </head>
            <body>
              <h2>✅ 簽到成功！</h2>
              <div class="success">
                <p><strong>簽到時間：</strong>${datetime}</p>
              </div>
              <div class="info">
                <p>學號：${studentId}</p>
                <p>姓名：${studentName}</p>
                <p>班級：${className}</p>
                ${parentLineId ? '<p>✅ 已發送通知給家長</p>' : '<p>⚠️ 未設定家長 LINE</p>'}
              </div>
            </body>
            </html>
          `);
        }
      }
    }

    // 找不到學生
    console.log('❌ 在所有試算表都找不到學號:', studentId);

    res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>簽到失敗</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
          h2 { color: #dc3545; }
          .error { background: #f8d7da; color: #721c24; padding: 15px; border-radius: 5px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <h2>❌ 簽到失敗</h2>
        <div class="error">
          <p>找不到學號或尚未建立今日欄位</p>
          <p>請聯絡教務老師確認 QR code 與出席表格</p>
        </div>
        <p style="color: #666; font-size: 14px;">學號：${studentId}</p>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('💥 錯誤:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>系統錯誤</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
          h2 { color: #dc3545; }
        </style>
      </head>
      <body>
        <h2>❌ 系統錯誤</h2>
        <p>伺服器發生錯誤，請稍後再試</p>
        <p style="color: #666; font-size: 14px;">如果問題持續，請聯絡系統管理員</p>
      </body>
      </html>
    `);
  }
}
