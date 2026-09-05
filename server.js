const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 📸 Gemini 1.5 Flash 무료 OCR 스캔 엔드포인트
app.post('/api/scan-contract', upload.single('contractImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '이미지가 업로드되지 않았습니다.' });
    }

    const imageParts = [
      {
        inlineData: {
          data: req.file.buffer.toString('base64'),
          mimeType: req.file.mimetype
        }
      }
    ];

    const prompt = `이 임대차 계약서 이미지에서 정밀한 정보를 추출해 JSON 형태로만 응답해줘. 
    마크다운 코드 블록(\`\`\`json 등)이나 기타 설명 텍스트 없이 오직 순수 JSON 객체만 반환해줘.
    Key 목록:
    - name: 건물명 및 호실명 (예: 동삭동 다가구 402호)
    - type: 아파트, 오피스텔, 다가구, 다세대 중 하나
    - tenant: 임차인 이름
    - amount: 월세 금액 (숫자만, 원 단위)
    - payDay: 월세 지정일 (숫자만)`;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent([prompt, ...imageParts]);
    const response = await result.response;
    
    let responseText = response.text().trim();
    responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

    const parsedData = JSON.parse(responseText);
    console.log("Gemini OCR 성공 데이터:", parsedData);

    res.json({ success: true, data: parsedData });

  } catch (error) {
    console.error('Gemini OCR Error 상세:', error);
    res.status(500).json({ success: false, error: error.message || 'AI 분석 실패' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
