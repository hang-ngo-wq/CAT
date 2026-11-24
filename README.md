# JobCat JP

Hệ thống phân loại danh mục nghề nghiệp tuyển dụng Nhật Bản chuẩn Kanji cho **Indeed**, **求人ボックス (26 ngành chuẩn)** và **求人部 (kèm nhóm 大分類)**, tích hợp bộ nhớ đệm MD5, gom lô 10–15 công việc/request và REST API.

## Triển khai lên GitHub & Vercel

1. Đẩy mã nguồn lên repository GitHub.
2. Đăng nhập [Vercel](https://vercel.com), chọn **Add New... > Project** và import repository vừa tạo.
3. Giữ nguyên cấu hình build mặc định (đã cấu hình sẵn trong `vercel.json`):
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Trong **Project Settings > Environment Variables**, khai báo biến môi trường phía server:
   - `GEMINI_API_KEY`: Gemini API Key chính
   - `GEMINI_API_KEYS` *(tùy chọn)*: Danh sách nhiều API Key cách nhau bởi dấu phẩy `,` để hệ thống tự xoay vòng khi hết quota
5. Nhấn **Deploy**.

> **Lưu ý bảo mật**: Mọi lệnh gọi Gemini AI được thực hiện hoàn toàn ở phía server (`/api/v1/*`) thông qua Vercel Serverless Functions (`api/index.ts`), không lưu hoặc lộ API Key trên trình duyệt người dùng.
