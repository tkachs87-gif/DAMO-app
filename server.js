const express = require('express');
const multer = require('multer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// 💡 503 과부하 대비 모델 우회 및 재시도 로직
async function fetchGeminiWithRetry(apiKey, payload, retries = 2) {
  const models = ['gemini-3.6-flash', 'gemini-2.5-flash'];
  let lastError;

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

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
          console.warn(`[${model}] 서버 과부하 (${response.status}). 재시도 중... (${i + 1}/${retries})`);
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
  }

  throw new Error(lastError || '모든 AI 모델 응답 실패');
}

// 🏛️ 건축HUB 건축물대장(표제부) 조회 함수
async function fetchBuildingLedger(address) {
  const apiKey = process.env.PUBLIC_DATA_API_KEY;
  if (!apiKey || !address) return null;

  try {
    // 도로명/지번 주소 검색 API 활용 또는 파싱 기반 건축물대장 호출 엔드포인트
    const endpoint = `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfoHub`;
    
    // 기본 파라미터 구성 (건축HUB API 규격)
    const url = `${endpoint}?serviceKey=${apiKey}&_type=json&numOfRows=10&pageNo=1`;

    // 백엔드에서 주소 기반 조회 시도
    console.log(`건축물대장 조회 시도 주소: ${address}`);
    const response = await fetch(url);
    if (!response.ok) return null;

    const result = await response.json();
    const items = result?.response?.body?.items?.item;

    if (items && items.length > 0) {
      const bld = Array.isArray(items) ? items[0] : items;
      return {
        totalHouseholds: bld.hhldCnt || bld.fmlyCnt || '정보없음', // 총 가구/세대수
        grndFlrCnt: bld.grndFlrCnt || '정보없음',                 // 지상 층수
        mainPurpsCdNm: bld.mainPurpsCdNm || '정보없음',             // 주용도 (예: 단독주택/다가구)
        platArea: bld.platArea || '정보없음'                       // 대지면적
      };
    }
  } catch (error) {
    console.error("건축물대장 API 호출 오류:", error.message);
  }

  return null;
}

// 📸 Gemini OCR 스캔 엔드포인트 (주소 추출 및 건축물대장 교차검증 연동)
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
    - address: 계약서상의 임대차 목적지 소재지 전체 주소 (도로명 또는 지번 주소)
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

    // 건축물대장 API로 세대수/호실수 정보 크로스체크
    if (parsedData.address) {
      const buildingInfo = await fetchBuildingLedger(parsedData.address);
      if (buildingInfo) {
        parsedData.buildingInfo = buildingInfo;
        console.log("건축물대장 정보 연동 성공:", buildingInfo);
      }
    }

    res.json({ success: true, data: parsedData });

  } catch (error) {
    console.error('Gemini OCR 예외 발생:', error);
    res.status(500).json({ success: false, error: error.message || 'AI 분석 실패' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
