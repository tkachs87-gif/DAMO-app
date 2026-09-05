const express = require('express');
const multer = require('multer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// 💡 503/429 과부하 대응 재시도 함수
async function fetchGeminiWithRetry(apiKey, payload, retries = 3) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  let lastError;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resultData = await response.json();

      if (response.ok) {
        return resultData;
      }

      if (response.status === 503 || response.status === 429) {
        console.warn(`서버 과부하 (${response.status}). 재시도 중... (${i + 1}/${retries})`);
        await new Promise(res => setTimeout(res, 1000 * (i + 1)));
        continue;
      }

      lastError = resultData.error?.message || 'Gemini API 호출 실패';
      break;
    } catch (err) {
      lastError = err.message;
      await new Promise(res => setTimeout(res, 1000));
    }
  }

  throw new Error(lastError || 'Gemini API 응답 실패');
}

// 📸 Gemini OCR 스캔 엔드포인트 (중개사 정보 포함)
app.post('/api/scan-contract', upload.single('contractImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '이미지가 업로드되지 않았습니다.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'GEMINI_API_KEY가 설정되지 않았습니다.' });
    }

    const base64Image = req.file.buffer.toString('base64');
    const prompt = `이 임대차 계약서 이미지에서 정밀한 정보를 추출해 JSON 형태로만 응답해줘. 
    마크다운 코드 블록(\`\`\`json 등)이나 기타 설명 텍스트 없이 오직 순수 JSON 객체만 반환해줘.
    Key 목록:
    - name: 건물명 및 호실명 (예: 동삭동 골든캐슬 402호)
    - type: 아파트, 오피스텔, 다가구, 다세대 중 하나
    - tenant: 임차인 이름
    - amount: 월세 금액 (숫자만, 원 단위)
    - payDay: 월세 지정일 (숫자만)
    - agentName: 중개사무소명 또는 소장님 이름 (없으면 "")
    - agentPhone: 중개사/소장님 연락처 (하이픈 포함 숫자, 없으면 "")`;

    const payload = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: req.file.mimetype || 'image/jpeg',
                data: base64Image
              }
            }
          ]
        }
      ]
    };

    const resultData = await fetchGeminiWithRetry(apiKey, payload);

    let responseText = resultData.candidates[0].content.parts[0].text.trim();
    responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

    const parsedData = JSON.parse(responseText);
    console.log("Gemini OCR 스캔 성공:", parsedData);

    res.json({ success: true, data: parsedData });

  } catch (error) {
    console.error('Gemini OCR 예외 발생:', error);
    res.status(500).json({ success: false, error: error.message || 'AI 분석 실패' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
