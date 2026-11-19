// Store screenshot copy. Panel/overlay UI strings come from the real _locales
// catalogs; everything here is the marketing copy and the demo content shown
// inside the real components (MIT 18.S096 Lecture 1, MIT OpenCourseWare).

export type Lang = "zh-CN" | "zh-TW" | "en" | "ja" | "ko";

export interface Feature { title: string; desc: string }

export interface Copy {
  htmlLang: string;
  font: string;
  brand: string;
  poster: {
    kicker: string;
    headline: string; // \n allowed
    sub: string;
    features: [Feature, Feature, Feature, Feature];
    trust: string[];
    providersLabel: string;
  };
  shots: {
    summary: [string, string];
    bilingual: [string, string];
    chat: [string, string];
    transcript: [string, string];
  };
  learningMode: string;
  summaryMd: string;
  chat: { q: string; a: string }[];
  /** Translation-view lines for the transcript shot: [startSeconds, text]. */
  transcript: [number, string][];
  cueTreasury: string;
  cueRealEstate: string;
  tile: { title: string; tags: string[] };
}

export const VIDEO_TITLE = "1. Introduction, Financial Terms and Concepts";

export const SOURCE_TREASURY =
  "treasury debt bonds notes bills and corporates have issued a lot of that when they need money";
export const SOURCE_REAL_ESTATE =
  "okay so let me look at what you came up with real estate I would say probably somewhere around here";

/** English source lines matching the transcript translation lines below. */
export const TRANSCRIPT_SOURCE: [number, number, string][] = [
  [883, 11, "other forms loans are actually more common than stocks"],
  [894, 9, "finance is really about some people have money some people don't so you lend it out"],
  [903, 9, "that's a loan a private agreement between counterparties"],
  [912, 10, "when you securitize it it becomes a bond"],
  [922, 3, "every government issues a lot of sovereign debt the US"],
  [925, 11, "treasury debt bonds notes bills and corporates have issued a lot of that when they need money"],
  [936, 9, "when a corporation builds a new plant or a university builds a new building they borrow"],
  [945, 8, "some of the money comes from donations some from research funding"],
  [953, 9, "some from public financing local governments states"],
  [962, 12, "and commodities metals energy agriculture mostly traded as futures"],
];

const PROVIDERS_NOTE = ["DeepSeek", "OpenAI", "Claude", "Gemini", "Kimi", "Qwen", "GLM", "Grok"];
export const PROVIDERS = PROVIDERS_NOTE;

export const COPY: Record<Lang, Copy> = {
  "zh-CN": {
    htmlLang: "zh-CN",
    font: '"Noto Sans SC"',
    brand: "YouTube AI 总结与翻译",
    poster: {
      kicker: "YouTube 浏览器扩展",
      headline: "外语长视频\n几分钟看懂",
      sub: "总结、双语字幕、追问、翻译，一个面板搞定",
      features: [
        { title: "AI 结构化总结", desc: "带时间戳，点击跳转原片" },
        { title: "播放器双语字幕", desc: "原文译文同步，可开学习模式" },
        { title: "就视频内容追问", desc: "只依据字幕回答，附出处时间" },
        { title: "全文逐段翻译", desc: "侧栏阅读，原文译文一键切换" },
      ],
      trust: ["自带 API Key", "数据直连服务商", "开源"],
      providersLabel: "支持",
    },
    shots: {
      summary: ["长视频，一眼掌握", "结构化要点 · 点击时间戳直达原片"],
      bilingual: ["双语字幕，边看边懂", "原文译文同步显示 · 支持全屏与影院模式"],
      chat: ["有疑问？直接问视频", "只依据字幕回答 · 附带可跳转的时间点"],
      transcript: ["字幕全文，翻成你的语言", "完整字幕按段翻译 · 原文译文一键切换"],
    },
    learningMode: "学习模式：鼠标悬停才显示译文",
    summaryMd: `### 课程介绍与安排
- [00:21] 这是 MIT 开放课程「金融中的数学」的第二次开设，由数学系与业界从业者联合讲授。
- [00:55] 今年扩展为 12 学分，每周二、周四上课，由四位讲师共同授课。
- [01:26] 新增线性代数、概率论、统计与随机微积分讲座，为理解业界案例打基础。

### 学生背景
- [03:21] 约 80% 为本科生、20% 为研究生，大多数是数学专业。
- [04:08] 欢迎外校学生旁听，往年也有来自哈佛的学生。

### 讲师故事：Vega 与 Kappa
- [05:33] 讲师回忆初到期权交易台的第一天，发现报表里缺少 vega。
- [06:59] Vega 衡量期权价格对波动率的敏感度，却不是真正的希腊字母。
- [08:11] 另一家机构的培训手册把同一指标称为 kappa，叫法不同、含义相同。`,
    chat: [
      {
        q: "Vega 和 Kappa 有什么区别？",
        a: `两者指的是**同一个指标**：期权价格对波动率变化的敏感度。

- [06:59] 讲师解释 vega 衡量波动率变动带来的价格变化，它并不是真正的希腊字母。
- [08:11] 他在另一家机构的培训手册里看到同一指标被称为 kappa。

所以区别只在名称，不在含义。`,
      },
      {
        q: "上这门课需要哪些数学基础？",
        a: `视频没有明确列出先修要求，但提到了课程会补充的内容：

- [01:26] 新增线性代数、概率论、统计和随机微积分讲座。
- [03:21] 现有学生大多是数学专业。`,
      },
    ],
    transcript: [
      [883, "在其他形式中，贷款其实比股票更普遍。"],
      [894, "金融本质上就是：有人有钱，有人缺钱，有钱的人把钱借出去。"],
      [903, "这就是贷款——交易双方之间的私人协议。"],
      [912, "当你把贷款证券化，它就变成了债券。"],
      [922, "每个国家的政府都发行大量主权债券，比如美国。"],
      [925, "国债、票据和短期国库券，企业在需要资金时也会大量发行。"],
      [936, "企业建新工厂、大学盖新楼时，也需要借钱。"],
      [945, "一部分资金来自捐赠，一部分来自研究经费。"],
      [953, "也有一部分来自公共融资，比如地方政府和州政府。"],
      [962, "还有大宗商品：金属、能源、农产品，大多以期货形式交易。"],
    ],
    cueTreasury: "国债、票据和短期国库券，企业在需要资金时也会大量发行。",
    cueRealEstate: "好，看看你们提出的：房地产。我会说它大概在这个位置。",
    tile: { title: "YouTube AI 总结与翻译", tags: ["双语字幕", "AI 总结", "追问"] },
  },

  "zh-TW": {
    htmlLang: "zh-TW",
    font: '"Noto Sans TC"',
    brand: "YouTube AI 總結與翻譯",
    poster: {
      kicker: "YouTube 瀏覽器擴充功能",
      headline: "外語長影片\n幾分鐘看懂",
      sub: "摘要、雙語字幕、提問、翻譯，一個面板搞定",
      features: [
        { title: "AI 結構化摘要", desc: "附時間戳記，點擊跳轉原片" },
        { title: "播放器雙語字幕", desc: "原文譯文同步，可開學習模式" },
        { title: "針對影片內容提問", desc: "只依據字幕回答，附出處時間" },
        { title: "全文逐段翻譯", desc: "側欄閱讀，原文譯文一鍵切換" },
      ],
      trust: ["自備 API Key", "資料直連服務商", "開源"],
      providersLabel: "支援",
    },
    shots: {
      summary: ["長影片，一眼掌握", "結構化重點 · 點擊時間戳記直達原片"],
      bilingual: ["雙語字幕，邊看邊懂", "原文譯文同步顯示 · 支援全螢幕與劇院模式"],
      chat: ["有疑問？直接問影片", "只依據字幕回答 · 附可跳轉的時間點"],
      transcript: ["字幕全文，翻成你的語言", "完整字幕分段翻譯 · 原文譯文一鍵切換"],
    },
    learningMode: "學習模式：滑鼠停留才顯示譯文",
    summaryMd: `### 課程介紹與安排
- [00:21] 這是 MIT 開放式課程「金融中的數學」第二次開課，由數學系與業界人士共同講授。
- [00:55] 今年擴大為 12 學分，每週二、週四上課，由四位講師共同授課。
- [01:26] 新增線性代數、機率論、統計與隨機微積分講座，為理解業界案例打底。

### 學生背景
- [03:21] 約 80% 為大學部學生、20% 為研究生，多數主修數學。
- [04:08] 歡迎外校學生旁聽，往年也有來自哈佛的學生。

### 講師故事：Vega 與 Kappa
- [05:33] 講師回憶初到選擇權交易台的第一天，發現報表裡少了 vega。
- [06:59] Vega 衡量選擇權價格對波動率的敏感度，卻不是真正的希臘字母。
- [08:11] 另一家機構的訓練手冊把同一指標稱為 kappa，名稱不同、意義相同。`,
    chat: [
      {
        q: "Vega 和 Kappa 有什麼差別？",
        a: `兩者指的是**同一個指標**：選擇權價格對波動率變化的敏感度。

- [06:59] 講師說明 vega 衡量波動率變動帶來的價格變化，它並不是真正的希臘字母。
- [08:11] 他在另一家機構的訓練手冊裡看到同一指標被稱為 kappa。

所以差別只在名稱，不在意義。`,
      },
      {
        q: "上這門課需要哪些數學基礎？",
        a: `影片沒有明確列出先修要求，但提到課程會補充的內容：

- [01:26] 新增線性代數、機率論、統計和隨機微積分講座。
- [03:21] 目前的學生多數主修數學。`,
      },
    ],
    transcript: [
      [883, "在其他形式中，貸款其實比股票更普遍。"],
      [894, "金融本質上就是：有人有錢、有人缺錢，有錢的人把錢借出去。"],
      [903, "這就是貸款——交易雙方之間的私人協議。"],
      [912, "當你把貸款證券化，它就變成了債券。"],
      [922, "每個國家的政府都發行大量主權債券，例如美國。"],
      [925, "公債、票據和短期國庫券，企業需要資金時也會大量發行。"],
      [936, "企業蓋新工廠、大學蓋新大樓時，也需要借錢。"],
      [945, "一部分資金來自捐贈，一部分來自研究經費。"],
      [953, "也有一部分來自公共融資，例如地方政府和州政府。"],
      [962, "還有大宗商品：金屬、能源、農產品，大多以期貨形式交易。"],
    ],
    cueTreasury: "公債、票據和短期國庫券，企業需要資金時也會大量發行。",
    cueRealEstate: "好，看看你們提出的：不動產。我會說它大概在這個位置。",
    tile: { title: "YouTube AI 總結與翻譯", tags: ["雙語字幕", "AI 摘要", "提問"] },
  },

  en: {
    htmlLang: "en",
    font: '"Inter"',
    brand: "YouTube AI Summary & Translation",
    poster: {
      kicker: "Browser extension for YouTube",
      headline: "Understand long\nvideos in minutes",
      sub: "Summaries, bilingual subtitles, Q&A and translation in one panel",
      features: [
        { title: "Structured AI summaries", desc: "Timestamped points that jump to the moment" },
        { title: "Bilingual player subtitles", desc: "Source and translation in sync, learning mode" },
        { title: "Ask about the video", desc: "Answers grounded in the captions, with timestamps" },
        { title: "Full transcript translation", desc: "Read in the side panel, switch source and translation" },
      ],
      trust: ["Your own API key", "Direct to your AI provider", "Open source"],
      providersLabel: "Works with",
    },
    shots: {
      summary: ["Get the gist of long videos", "Structured key points · Click a timestamp to jump"],
      bilingual: ["Bilingual subtitles, in sync", "Source and translation together · Fullscreen and theater mode"],
      chat: ["Ask the video anything", "Answers grounded in the captions · Clickable timestamps"],
      transcript: ["Read the whole transcript, translated", "Translated section by section · Switch to the source anytime"],
    },
    learningMode: "Learning mode: hover to reveal the translation",
    summaryMd: `### Course overview
- [00:21] The second offering of MIT's Topics in Mathematics with Applications in Finance, taught by math faculty and industry practitioners.
- [00:55] Expanded to 12 units this year, meeting Tuesdays and Thursdays with four instructors.
- [01:26] New lectures on linear algebra, probability, statistics and stochastic calculus build the foundation for industry case studies.

### Who is in the class
- [03:21] About 80% undergraduates and 20% graduate students, mostly math majors.
- [04:08] Students from other schools are welcome; past years included Harvard students.

### Instructor story: Vega and Kappa
- [05:33] On his first day at an options trading desk, the instructor found vega missing from the risk report.
- [06:59] Vega measures an option's sensitivity to volatility, yet it is not actually a Greek letter.
- [08:11] Another firm's training manual called the same measure kappa: different name, same meaning.`,
    chat: [
      {
        q: "What's the difference between vega and kappa?",
        a: `They are **the same measure**: how sensitive an option's price is to changes in volatility.

- [06:59] The instructor explains that vega captures price changes caused by volatility, and is not a real Greek letter.
- [08:11] He later saw the same measure called kappa in another firm's training manual.

So the difference is only the name, not the meaning.`,
      },
      {
        q: "What math background do I need for this course?",
        a: `The video doesn't list formal prerequisites, but it mentions what the course adds:

- [01:26] New lectures on linear algebra, probability, statistics and stochastic calculus.
- [03:21] Most current students are math majors.`,
      },
    ],
    transcript: [
      [883, "Entre otras formas, los préstamos son en realidad más comunes que las acciones."],
      [894, "Las finanzas consisten en esto: unos tienen dinero, otros no, y quien lo tiene lo presta."],
      [903, "Eso es un préstamo: un acuerdo privado entre contrapartes."],
      [912, "Cuando lo titulizas, se convierte en un bono."],
      [922, "Todos los gobiernos emiten mucha deuda soberana, como EE. UU."],
      [925, "Bonos, pagarés y letras del Tesoro; las empresas también emiten mucho cuando necesitan dinero."],
      [936, "Cuando una empresa construye una planta o una universidad un edificio, piden prestado."],
      [945, "Parte del dinero viene de donaciones y parte de fondos de investigación."],
      [953, "Otra parte viene de financiación pública: gobiernos locales y estatales."],
      [962, "Y las materias primas: metales, energía y agricultura, casi siempre como futuros."],
    ],
    cueTreasury: "Bonos, pagarés y letras del Tesoro; las empresas también emiten mucho cuando necesitan dinero.",
    cueRealEstate: "Bien, veamos lo que propusieron: bienes raíces. Yo diría que está más o menos aquí.",
    tile: { title: "YouTube AI Summary & Translation", tags: ["Bilingual subtitles", "AI summaries", "Q&A"] },
  },

  ja: {
    htmlLang: "ja",
    font: '"Noto Sans JP"',
    brand: "YouTube AI 要約・翻訳",
    poster: {
      kicker: "YouTube 向けブラウザ拡張機能",
      headline: "外国語の長い動画も\n数分で理解",
      sub: "要約・二言語字幕・質問・翻訳をひとつのパネルで",
      features: [
        { title: "AI による構造化要約", desc: "タイムスタンプから該当箇所へ移動" },
        { title: "プレーヤーに二言語字幕", desc: "原文と訳文を同期表示、学習モード対応" },
        { title: "動画の内容を質問", desc: "字幕だけを根拠に回答、出典時刻つき" },
        { title: "字幕全文をセクション翻訳", desc: "サイドパネルで読み、原文と訳文を切替" },
      ],
      trust: ["自分の API キーを使用", "AI サービスへ直接送信", "オープンソース"],
      providersLabel: "対応",
    },
    shots: {
      summary: ["長い動画も、ひと目で把握", "構造化された要点 · タイムスタンプで瞬時に移動"],
      bilingual: ["二言語字幕を同期表示", "原文と訳文を同時に表示 · 全画面・シアターモード対応"],
      chat: ["わからない所は動画に質問", "字幕だけを根拠に回答 · クリックできる時刻つき"],
      transcript: ["字幕全文を、翻訳して読む", "セクションごとに翻訳 · 原文と訳文をすぐ切替"],
    },
    learningMode: "学習モード：マウスを重ねると訳文を表示",
    summaryMd: `### コース紹介と概要
- [00:21] MIT OpenCourseWare「金融における数学」の 2 回目の開講。数学科の教員と業界の実務家が担当します。
- [00:55] 今年は 12 単位に拡大し、火曜・木曜の週 2 回、4 名の講師で行います。
- [01:26] 線形代数・確率論・統計・確率微分の講義を追加し、業界事例を理解する基礎を固めます。

### 受講生の構成
- [03:21] 学部生が約 80%、大学院生が約 20%。多くは数学専攻です。
- [04:08] 他大学からの聴講も歓迎。過去にはハーバードの学生もいました。

### 講師のエピソード：Vega と Kappa
- [05:33] オプション取引デスクでの初日、リスク報告に vega がないことに気づいた話。
- [06:59] Vega はボラティリティに対する価格の感応度で、実はギリシャ文字ではありません。
- [08:11] 別の会社の研修資料では同じ指標を kappa と呼んでいました。名前が違うだけで意味は同じです。`,
    chat: [
      {
        q: "Vega と Kappa の違いは何ですか？",
        a: `どちらも**同じ指標**で、ボラティリティの変化に対するオプション価格の感応度を表します。

- [06:59] 講師は、vega がボラティリティによる価格変化を測るもので、本当のギリシャ文字ではないと説明しています。
- [08:11] 別の会社の研修資料では、同じ指標が kappa と呼ばれていました。

違いは名前だけで、意味は同じです。`,
      },
      {
        q: "この講義に必要な数学の前提知識は？",
        a: `動画では正式な前提条件は挙げられていませんが、講義で補う内容に触れています。

- [01:26] 線形代数・確率論・統計・確率微分の講義を追加。
- [03:21] 現在の受講生の多くは数学専攻です。`,
      },
    ],
    transcript: [
      [883, "ほかの形態では、実は株式よりもローンのほうが一般的です。"],
      [894, "金融とは、お金を持つ人と持たない人がいて、持つ人が貸し出すことです。"],
      [903, "それがローン、つまり取引当事者間の私的な契約です。"],
      [912, "それを証券化すると、債券になります。"],
      [922, "どの国の政府も大量の国債を発行しています。米国もそうです。"],
      [925, "国債、ノート、ビル。企業も資金が必要なときに大量に発行しています。"],
      [936, "企業が新工場を、大学が新しい建物を建てるときも、お金を借ります。"],
      [945, "資金の一部は寄付、一部は研究資金から来ています。"],
      [953, "公的な資金調達、たとえば地方政府や州からも来ます。"],
      [962, "そしてコモディティ。金属、エネルギー、農産物で、多くは先物で取引されます。"],
    ],
    cueTreasury: "国債、ノート、ビル。企業も資金が必要なときに大量に発行します。",
    cueRealEstate: "では、みなさんの答えを見てみましょう。不動産は、だいたいこのあたりでしょう。",
    tile: { title: "YouTube AI 要約・翻訳", tags: ["二言語字幕", "AI 要約", "質問"] },
  },

  ko: {
    htmlLang: "ko",
    font: '"Noto Sans KR"',
    brand: "YouTube AI 요약 및 번역",
    poster: {
      kicker: "YouTube용 브라우저 확장 프로그램",
      headline: "외국어 긴 영상도\n몇 분 만에 이해",
      sub: "요약, 이중 자막, 질문, 번역을 하나의 패널에서",
      features: [
        { title: "AI 구조화 요약", desc: "타임스탬프를 눌러 해당 장면으로 이동" },
        { title: "플레이어 이중 자막", desc: "원문과 번역 동기화, 학습 모드 지원" },
        { title: "영상 내용 질문하기", desc: "자막만 근거로 답변, 출처 시간 표시" },
        { title: "전체 자막 구간 번역", desc: "사이드 패널에서 읽고 원문과 번역 전환" },
      ],
      trust: ["내 API 키 사용", "AI 서비스와 직접 연결", "오픈 소스"],
      providersLabel: "지원",
    },
    shots: {
      summary: ["긴 영상도 한눈에", "구조화된 핵심 정리 · 타임스탬프로 바로 이동"],
      bilingual: ["이중 자막, 실시간 동기화", "원문과 번역을 함께 표시 · 전체 화면과 극장 모드 지원"],
      chat: ["궁금한 점은 영상에 질문", "자막만 근거로 답변 · 클릭 가능한 타임스탬프"],
      transcript: ["전체 자막을 번역해서 읽기", "구간별 번역 · 원문과 번역을 바로 전환"],
    },
    learningMode: "학습 모드: 마우스를 올리면 번역 표시",
    summaryMd: `### 강의 소개와 구성
- [00:21] MIT OpenCourseWare '금융 속의 수학' 강의의 두 번째 개설로, 수학과 교수진과 업계 실무자가 함께 가르칩니다.
- [00:55] 올해는 12학점으로 늘어 화요일과 목요일 주 2회, 강사 4명이 진행합니다.
- [01:26] 선형대수, 확률론, 통계, 확률미적분 강의를 추가해 업계 사례를 이해할 기초를 다집니다.

### 수강생 구성
- [03:21] 학부생 약 80%, 대학원생 약 20%이며 대부분 수학 전공입니다.
- [04:08] 다른 학교 학생의 청강도 환영하며, 예년에는 하버드 학생도 있었습니다.

### 강사 이야기: Vega와 Kappa
- [05:33] 옵션 트레이딩 데스크 첫날, 리스크 보고서에 vega가 없다는 것을 발견한 이야기.
- [06:59] Vega는 변동성에 대한 옵션 가격의 민감도이지만, 실제 그리스 문자는 아닙니다.
- [08:11] 다른 회사의 교육 자료에서는 같은 지표를 kappa라고 불렀습니다. 이름만 다를 뿐 의미는 같습니다.`,
    chat: [
      {
        q: "Vega와 Kappa는 어떻게 다른가요?",
        a: `둘은 **같은 지표**로, 변동성 변화에 대한 옵션 가격의 민감도를 뜻합니다.

- [06:59] 강사는 vega가 변동성에 따른 가격 변화를 측정하며, 실제 그리스 문자는 아니라고 설명합니다.
- [08:11] 다른 회사의 교육 자료에서는 같은 지표를 kappa라고 불렀습니다.

차이는 이름뿐이고 의미는 같습니다.`,
      },
      {
        q: "이 강의를 들으려면 어떤 수학 지식이 필요한가요?",
        a: `영상에서 정식 선수 과목을 밝히지는 않지만, 강의에서 보충하는 내용을 언급합니다.

- [01:26] 선형대수, 확률론, 통계, 확률미적분 강의를 추가했습니다.
- [03:21] 현재 수강생은 대부분 수학 전공입니다.`,
      },
    ],
    transcript: [
      [883, "다른 형태 중에서는 사실 주식보다 대출이 더 흔합니다."],
      [894, "금융이란 돈이 있는 사람과 없는 사람이 있고, 있는 사람이 빌려주는 것입니다."],
      [903, "그게 대출, 즉 거래 당사자 간의 사적인 계약입니다."],
      [912, "이를 증권화하면 채권이 됩니다."],
      [922, "모든 정부가 국채를 대량으로 발행합니다. 미국도 마찬가지입니다."],
      [925, "국채, 중기채, 단기채. 기업도 자금이 필요할 때 많이 발행합니다."],
      [936, "기업이 새 공장을, 대학이 새 건물을 지을 때도 돈을 빌립니다."],
      [945, "자금의 일부는 기부금, 일부는 연구비에서 나옵니다."],
      [953, "지방 정부나 주 정부 같은 공공 자금 조달에서도 나옵니다."],
      [962, "그리고 원자재. 금속, 에너지, 농산물로, 대부분 선물로 거래됩니다."],
    ],
    cueTreasury: "국채, 중기채, 단기채. 기업도 자금이 필요할 때 많이 발행합니다.",
    cueRealEstate: "자, 여러분이 낸 답을 봅시다. 부동산은 대략 이쯤이라고 하겠습니다.",
    tile: { title: "YouTube AI 요약 및 번역", tags: ["이중 자막", "AI 요약", "질문"] },
  },
};
