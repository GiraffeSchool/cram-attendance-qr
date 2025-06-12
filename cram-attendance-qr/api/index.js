// api/index.js
export default function handler(req, res) {
  res.status(200).json({
    status: "ok",
    message: "育名補習班簽到系統運行中",
    endpoints: ["/api/attend", "/api/webhook"],
    timestamp: new Date().toISOString(),
  });
}
