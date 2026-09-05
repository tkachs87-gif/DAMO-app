const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 📸 AI OCR 스캔 엔드포인트
app.post('/api/scan-contract', upload.single('contractImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '이미지가 업로드되지 않았습니다.' });
    }

    const base64Image = req.file.buffer.toString('base64');

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { 
              type: "text", 
              text: "이 임대차 계약서 이미지에서 정밀한 정보를 추출해 JSON으로 응답해줘. Key: name (건물명 및 호실명), type (아파트/오피스텔/다가구/다세대 중 하나), tenant (임차인 이름), amount (월세 금액 숫자만, 원 단위), payDay (월세 지정일 숫자만)." 
            },
            {
              type: "image_url",
              image_url: { url: `data:${req.file.mimetype};base64,${base64Image}` }
            }
          ]
        }
      ],
      response_format: { type: "json_object" }
    });

    const parsedData = JSON.parse(response.choices[0].message.content);
    res.json({ success: true, data: parsedData });

  } catch (error) {
    console.error('OCR Error:', error);
    res.status(500).json({ success: false, error: 'AI 분석 실패' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
