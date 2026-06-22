const { createClient } = supabase;

const SUPABASE_URL = "https://vmeuwbdunjdzrtwjkdt.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtZXV3YmR1bmpkenJ0dndqYWtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNzQzMTcsImV4cCI6MjA5NzY1MDMxN30.CWma-lPSkpf5yOVf8xZD4Yf_9psNWnCVQnmtNX1zrpU";

const _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const STORAGE_KEY = "itdictionary_pages";

const DEFAULT_TERMS = [];

let dbPages = [];
let audioContextInstance = null;
let currentActiveViewPageIdx = 0;
let lastActiveViewPageIdx = 0;
let userDrawingStrokesStack = [];
let drawingCanvasContext = null;
let currentDrawingModeTool = "brush";
let isCurrentlyDrawingOnCanvas = false;
let userSelectedDrawingColor = "#00bcff";
let userSelectedDrawingSize = 4;
let lastRecordedCoordinates = { x: 0, y: 0 };
let activePageAttachmentTargetId = null;
let activePageDeletionTargetId = null;
let temporalAttachmentContainer = null;
let simulatedVoiceRecorderIntervalId = null;
let voiceRecordingDurationSeconds = 0;
let audioRecordingBlobUrl = null;
let isAudioRecordingActiveState = false;
let mindmapTextNodes = [];
let mindmapNodeConnectors = [];
let activeSoundEffectsConfig = true;

const queryHTMLElement = (selector) => document.querySelector(selector);
const queryHTMLElementById = (id) => document.getElementById(id);
const queryAllHTMLElements = (selector) => document.querySelectorAll(selector);

function showLoadingToast(msg) {
  let toast = document.getElementById("api-loading-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "api-loading-toast";
    toast.style.position = "fixed";
    toast.style.bottom = "20px";
    toast.style.right = "20px";
    toast.style.background = "#1e293b";
    toast.style.color = "#fff";
    toast.style.padding = "12px 24px";
    toast.style.borderRadius = "8px";
    toast.style.boxShadow = "0 10px 15px -3px rgba(0, 0, 0, 0.3)";
    toast.style.zIndex = "999999";
    toast.style.display = "flex";
    toast.style.alignItems = "center";
    toast.style.gap = "10px";
    toast.style.fontFamily = "var(--sans-font)";
    toast.style.fontSize = "0.85rem";
    toast.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> <span class="api-toast-text">Cargando...</span>`;
    document.body.appendChild(toast);
  }
  toast.querySelector(".api-toast-text").textContent = msg;
  toast.style.display = "flex";
}

function hideLoadingToast() {
  const toast = document.getElementById("api-loading-toast");
  if (toast) toast.style.display = "none";
}

function initializeDictionaryApp() {
  retrievePersistentDatabase();
  initializeAlphabetLettersSearchModal();
  buildAlphabetPillsListeners();
  buildCentralBookNavigationListeners();
  buildGeneralModalsStateHandlers();
  buildInteractiveCanvasHandlers();
  buildWizardUploaderStepHandlers();
  refreshStatsCounters();
  renderDigitalBookState();
}

function retrievePersistentDatabase() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      dbPages = JSON.parse(stored);
    } else {
      // Seed default letters A-Z and category pages
      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
      const predetTitles = [
        ...letters,
        "PDF",
        "EXCEL",
        "WORD",
        "PHOTO",
        "VIDEO",
        "LINK",
        "NOTE",
      ];
      dbPages = predetTitles.map((title) => {
        return {
          id: "predet-" + title.toLowerCase(),
          term: title,
          contents: [],
        };
      });
      persistDatabaseState();
    }
    refreshStatsCounters();
  } catch (err) {
    console.error("Retrieving local storage database failed:", err);
    dbPages = [];
  }
}

function parsePageTerm(term) {
  if (!term || typeof term !== "string") {
    return { baseTerm: "", num: 0 };
  }
  const match = term.match(/^(.*?)(?:\s+([1-9]\d*))?$/);
  if (match) {
    return {
      baseTerm: match[1].trim(),
      num: match[2] ? parseInt(match[2], 10) : 0,
    };
  }
  return { baseTerm: term.trim(), num: 0 };
}

function getPagesForBaseTerm(baseTerm) {
  const normalizedBase = baseTerm.trim().toUpperCase();
  return dbPages.filter((p) => {
    if (!p || !p.term) return false;
    const parsed = parsePageTerm(p.term);
    return parsed.baseTerm.trim().toUpperCase() === normalizedBase;
  });
}

async function addContentBlockToTargetPage(
  pageIdOrTerm,
  blockType,
  blockData,
  optionalFilenameOrName,
  autoDetectPredetermined = false,
) {
  let baseTerm = "";

  if (autoDetectPredetermined || !pageIdOrTerm) {
    baseTerm = getTargetPredeterminedPageTitle(
      blockType,
      optionalFilenameOrName,
    );
  } else {
    let foundPage = dbPages.find(
      (p) =>
        p.id === pageIdOrTerm ||
        p.term.trim().toUpperCase() === pageIdOrTerm.trim().toUpperCase(),
    );
    if (foundPage) {
      const parsed = parsePageTerm(foundPage.term);
      baseTerm = parsed.baseTerm;
    } else {
      baseTerm = getTargetPredeterminedPageTitle(
        blockType,
        optionalFilenameOrName,
      );
    }
  }

  baseTerm = baseTerm.trim().toUpperCase();

  const pagesList = getPagesForBaseTerm(baseTerm);
  pagesList.sort((left, right) => {
    const leftParsed = parsePageTerm(left.term);
    const rightParsed = parsePageTerm(right.term);
    return leftParsed.num - rightParsed.num;
  });

  const MAX_BLOCKS = 4;
  let selectedPage = null;

  if (pagesList.length > 0) {
    const lastPage = pagesList[pagesList.length - 1];
    if (lastPage.contents && lastPage.contents.length < MAX_BLOCKS) {
      selectedPage = lastPage;
    } else {
      const lastParsed = parsePageTerm(lastPage.term);
      const nextNum = lastParsed.num === 0 ? 2 : lastParsed.num + 1;
      const nextTermName = baseTerm + " " + nextNum;

      selectedPage = {
        id:
          "replica-" +
          baseTerm.toLowerCase() +
          "-" +
          nextNum +
          "-" +
          generateUniqueId(),
        term: nextTermName,
        contents: [],
        isCopy: true,
        baseTerm: baseTerm,
      };
      dbPages.push(selectedPage);
    }
  } else {
    selectedPage = {
      id: "predet-" + baseTerm.toLowerCase(),
      term: baseTerm,
      contents: [],
    };
    dbPages.push(selectedPage);
  }

  if (!selectedPage.contents) {
    selectedPage.contents = [];
  }

  let finalBlockData = blockData;
  let finalFilename = optionalFilenameOrName;

  if (
    [
      "image",
      "audio",
      "pdf",
      "word",
      "excel",
      "video",
      "mindmap",
      "file",
    ].includes(blockType)
  ) {
    let fname = optionalFilenameOrName || `upload_${Date.now()}`;
    if (blockType === "mindmap") {
      fname = `canvas_${Date.now()}.png`;
    } else if (blockType === "image") {
      fname = `imagen_${Date.now()}.png`;
    } else if (blockType === "audio") {
      fname = `audio_${Date.now()}.wav`;
    }
    finalFilename = fname;
  }

  const newBlock = {
    id: generateUniqueId(),
    type: blockType,
    data: finalBlockData,
  };
  if (finalFilename) {
    newBlock.name = finalFilename;
  }

  selectedPage.contents.push(newBlock);
  persistDatabaseState();
  return selectedPage.id;
}

async function getOrCreatePredeterminedPage(termName) {
  const normalized = termName.trim().toUpperCase();
  let page = dbPages.find((p) => p.term.trim().toUpperCase() === normalized);
  if (!page) {
    page = {
      id: "predet-" + normalized.toLowerCase(),
      term: normalized,
      contents: [],
    };
    dbPages.push(page);
    persistDatabaseState();
  }
  return page;
}

function getTargetPredeterminedPageTitle(blockType, filename) {
  if (blockType === "paragraph") {
    return "NOTE";
  }
  if (blockType === "audio") {
    return "NOTE";
  }
  if (blockType === "link") {
    return "LINK";
  }
  if (blockType === "mindmap") {
    return "PHOTO";
  }
  if (blockType === "image") {
    return "PHOTO";
  }
  if (blockType === "pdf") {
    return "PDF";
  }
  if (blockType === "video") {
    return "VIDEO";
  }

  if (filename) {
    const ext = filename.split(".").pop().toLowerCase();
    if (ext === "pdf") {
      return "PDF";
    }
    if (["xls", "xlsx", "csv"].includes(ext)) {
      return "EXCEL";
    }
    if (["doc", "docx", "ppt", "pptx"].includes(ext)) {
      return "WORD";
    }
    if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
      return "PHOTO";
    }
    if (["mp4", "webm", "avi", "mov"].includes(ext)) {
      return "VIDEO";
    }
    if (["mp3", "wav", "m4a", "ogg"].includes(ext)) {
      return "NOTE";
    }
  }

  return "NOTE";
}

async function addContentBlockToPredeterminedPage(
  blockType,
  blockData,
  optionalFilenameOrName,
) {
  return await addContentBlockToTargetPage(
    null,
    blockType,
    blockData,
    optionalFilenameOrName,
    true,
  );
}

function persistDatabaseState() {
  refreshStatsCounters();
}

function initializeAlphabetLettersSearchModal() {
  const lettersTarget = queryHTMLElementById("modal-letter-shortcuts");
  if (!lettersTarget) return;
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");
  lettersTarget.innerHTML = "";

  letters.forEach((letra) => {
    const btn = document.createElement("button");
    btn.className = "idx-shortcut-btn";
    btn.textContent = letra;
    btn.style.width = "42px";
    btn.style.height = "42px";
    btn.style.fontSize = "1.05rem";
    btn.style.fontWeight = "bold";
    btn.style.borderRadius = "8px";
    btn.style.background = "#1e293b";
    btn.style.border = "1px solid #334155";
    btn.style.color = "#cbd5e1";
    btn.style.cursor = "pointer";
    btn.style.transition = "all 0.15s";
    btn.style.display = "flex";
    btn.style.alignItems = "center";
    btn.style.justifyContent = "center";

    btn.addEventListener("mouseover", () => {
      btn.style.background = "var(--accent-color)";
      btn.style.borderColor = "var(--accent-color)";
      btn.style.color = "#fff";
      btn.style.transform = "scale(1.1)";
    });

    btn.addEventListener("mouseout", () => {
      btn.style.background = "#1e293b";
      btn.style.borderColor = "#334155";
      btn.style.color = "#cbd5e1";
      btn.style.transform = "scale(1.0)";
    });

    btn.addEventListener("click", () => {
      const modal = queryHTMLElementById("letters-search-modal");
      if (modal) {
        modal.classList.add("hidden");
      }

      const searchBoxInput = queryHTMLElementById("terms-search");
      if (searchBoxInput) searchBoxInput.value = "";

      const pillsContainerButtons = queryAllHTMLElements(
        "#alphabet-pills .pill",
      );
      pillsContainerButtons.forEach((bi) => bi.classList.remove("active"));

      const finalIndexToJump = searchMatchingPillGroupForLetter(letra);
      if (finalIndexToJump) {
        finalIndexToJump.classList.add("active");
      }
      setTimeout(() => {
        navigateToFirstMatchingLetterPage(letra);
      }, 50);
    });

    lettersTarget.appendChild(btn);
  });
}

function detectFileType(filename) {
  if (!filename) return "pdf";
  const ext = filename.split(".").pop().toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
    return "image";
  }
  if (["mp3", "wav", "m4a", "ogg"].includes(ext)) {
    return "audio";
  }
  if (["mp4", "webm", "avi", "mov"].includes(ext)) {
    return "video";
  }
  if (ext === "pdf") {
    return "pdf";
  }
  return "file";
}

function getFileIconClass(filename) {
  if (!filename) return "fa-solid fa-file";
  const ext = filename.split(".").pop().toLowerCase();
  switch (ext) {
    case "xls":
    case "xlsx":
    case "csv":
      return "fa-solid fa-file-excel";
    case "doc":
    case "docx":
      return "fa-solid fa-file-word";
    case "ppt":
    case "pptx":
      return "fa-solid fa-file-powerpoint";
    case "pdf":
      return "fa-solid fa-file-pdf";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
      return "fa-solid fa-file-image";
    case "mp3":
    case "wav":
    case "m4a":
    case "ogg":
      return "fa-solid fa-file-audio";
    case "mp4":
    case "webm":
    case "avi":
    case "mov":
      return "fa-solid fa-file-video";
    case "zip":
    case "rar":
    case "tar":
    case "gz":
      return "fa-solid fa-file-zipper";
    default:
      return "fa-solid fa-file-lines";
  }
}

function getFileTypeLabel(filename) {
  if (!filename) return "DOCUMENT";
  const ext = filename.split(".").pop().toUpperCase();
  if (ext === "XLS" || ext === "XLSX") return "EXCEL SPREADSHEET";
  if (ext === "DOC" || ext === "DOCX") return "WORD DOCUMENT";
  if (ext === "PPT" || ext === "PPTX") return "POWERPOINT SLIDES";
  if (ext === "ZIP" || ext === "RAR") return "COMPRESSED ARCHIVE";
  return ext + " FILE";
}

window.downloadDataUrlFile = function (dataUrl, name) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = name || "download";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

function extractFirstAlphabeticalChar(termName) {
  if (!termName || typeof termName !== "string") return "#";
  const cleanTerm = termName.trim();
  for (let idx = 0; idx < cleanTerm.length; idx++) {
    const char = cleanTerm.charAt(idx);
    if (/[a-zA-Z]/.test(char)) {
      return char.toUpperCase();
    }
  }
  return "#";
}

function generateUniqueId() {
  return (
    "term-" + Math.random().toString(36).substr(2, 9) + Date.now().toString(36)
  );
}

function triggerSynthesizedPageSound() {
  if (!activeSoundEffectsConfig) return;
  try {
    if (!audioContextInstance) {
      audioContextInstance = new (
        window.AudioContext || window.webkitAudioContext
      )();
    }
    if (audioContextInstance.state === "suspended") {
      audioContextInstance.resume();
    }
    const bufferSize = audioContextInstance.sampleRate * 0.45;
    const noiseBuffer = audioContextInstance.createBuffer(
      1,
      bufferSize,
      audioContextInstance.sampleRate,
    );
    const outputChannel = noiseBuffer.getChannelData(0);
    for (let idx = 0; idx < bufferSize; idx++) {
      outputChannel[idx] = Math.random() * 2 - 1;
    }
    const noiseNode = audioContextInstance.createBufferSource();
    noiseNode.buffer = noiseBuffer;
    const soundLowpassFilter = audioContextInstance.createBiquadFilter();
    soundLowpassFilter.type = "lowpass";
    soundLowpassFilter.frequency.setValueAtTime(
      450,
      audioContextInstance.currentTime,
    );
    soundLowpassFilter.frequency.exponentialRampToValueAtTime(
      140,
      audioContextInstance.currentTime + 0.35,
    );
    const soundBandpassFilter = audioContextInstance.createBiquadFilter();
    soundBandpassFilter.type = "bandpass";
    soundBandpassFilter.frequency.setValueAtTime(
      320,
      audioContextInstance.currentTime,
    );
    soundBandpassFilter.Q.setValueAtTime(4.0, audioContextInstance.currentTime);
    const soundGainNode = audioContextInstance.createGain();
    soundGainNode.gain.setValueAtTime(0.001, audioContextInstance.currentTime);
    soundGainNode.gain.linearRampToValueAtTime(
      0.18,
      audioContextInstance.currentTime + 0.08,
    );
    soundGainNode.gain.exponentialRampToValueAtTime(
      0.001,
      audioContextInstance.currentTime + 0.4,
    );
    noiseNode.connect(soundLowpassFilter);
    soundLowpassFilter.connect(soundBandpassFilter);
    soundBandpassFilter.connect(soundGainNode);
    soundGainNode.connect(audioContextInstance.destination);
    noiseNode.start();
  } catch (err) {}
}

function isSingleIndexChar(term) {
  if (!term || typeof term !== "string") return false;
  const trimmed = term.trim();
  return trimmed.length === 1;
}

function isLongPhrase(term) {
  if (!term || typeof term !== "string") return false;
  const trimmed = term.trim();
  const parsed = parsePageTerm(trimmed);
  if (parsed.num > 0) return false;
  return trimmed.includes(" ") || trimmed.length > 20;
}

function filterAndSortDatabaseRecords() {
  const queryStr = (queryHTMLElementById("terms-search").value || "")
    .toLowerCase()
    .trim();
  const rawPillFilter = queryHTMLElement(".pill.active");
  const pillRangeFilter = rawPillFilter ? rawPillFilter.dataset.range : "all";
  let dataset = dbPages.filter((item) => {
    if (!item || !item.term) return false;
    const nameMatches = item.term.toLowerCase().includes(queryStr);
    const matchingFirstLetter = extractFirstAlphabeticalChar(item.term);
    let rangeMatches = true;
    if (pillRangeFilter === "nums") {
      rangeMatches = matchingFirstLetter === "#";
    } else if (pillRangeFilter && pillRangeFilter !== "all") {
      const parts = pillRangeFilter.split("-");
      const startLetterRangeCode = parts[0].charCodeAt(0);
      const endLetterRangeCode = parts[1].charCodeAt(0);
      const charCodeToCompare = matchingFirstLetter.charCodeAt(0);
      rangeMatches =
        charCodeToCompare >= startLetterRangeCode &&
        charCodeToCompare <= endLetterRangeCode;
    }
    return nameMatches && rangeMatches;
  });
  dataset.sort((left, right) => {
    // Check if either is a pre-determined attachment category page
    const leftIsPredet = [
      "PDF",
      "EXCEL",
      "WORD",
      "PHOTO",
      "VIDEO",
      "LINK",
      "NOTE",
    ].includes(parsePageTerm(left.term).baseTerm.toUpperCase());
    const rightIsPredet = [
      "PDF",
      "EXCEL",
      "WORD",
      "PHOTO",
      "VIDEO",
      "LINK",
      "NOTE",
    ].includes(parsePageTerm(right.term).baseTerm.toUpperCase());

    // Put pre-determined category pages at the very end of the book
    if (leftIsPredet && !rightIsPredet) return 1;
    if (!leftIsPredet && rightIsPredet) return -1;
    if (leftIsPredet && rightIsPredet) {
      const predetOrder = [
        "PDF",
        "EXCEL",
        "WORD",
        "PHOTO",
        "VIDEO",
        "LINK",
        "NOTE",
      ];
      const leftBase = parsePageTerm(left.term).baseTerm.toUpperCase();
      const rightBase = parsePageTerm(right.term).baseTerm.toUpperCase();
      const leftIdx = predetOrder.indexOf(leftBase);
      const rightIdx = predetOrder.indexOf(rightBase);
      if (leftIdx !== rightIdx) {
        return leftIdx - rightIdx;
      }
      return left.term.toUpperCase().localeCompare(right.term.toUpperCase());
    }

    // 1. Group standard pages by their starting letter alphabetical character
    const lLetter = extractFirstAlphabeticalChar(left.term);
    const rLetter = extractFirstAlphabeticalChar(right.term);

    if (lLetter === "#" && rLetter !== "#") return 1;
    if (lLetter !== "#" && rLetter === "#") return -1;
    if (lLetter !== rLetter) {
      return lLetter.localeCompare(rLetter);
    }

    // 2. Within the same letter group, put the single index landmark (e.g. "A") absolute first
    const leftIsSingle = isSingleIndexChar(left.term);
    const rightIsSingle = isSingleIndexChar(right.term);
    if (leftIsSingle && !rightIsSingle) return -1;
    if (!leftIsSingle && rightIsSingle) return 1;
    if (leftIsSingle && rightIsSingle) {
      return left.term.toLowerCase().localeCompare(right.term.toLowerCase());
    }

    // 3. Put long phrases after short terms
    const leftIsLong = isLongPhrase(left.term);
    const rightIsLong = isLongPhrase(right.term);
    if (leftIsLong && !rightIsLong) return 1;
    if (!leftIsLong && rightIsLong) return -1;
    if (leftIsLong && rightIsLong) {
      return left.term.toLowerCase().localeCompare(right.term.toLowerCase());
    }

    // 4. Sort copy suffix numbers naturally (e.g. A 2, A 3)
    const leftParsed = parsePageTerm(left.term);
    const rightParsed = parsePageTerm(right.term);
    if (
      leftParsed.baseTerm.toLowerCase() === rightParsed.baseTerm.toLowerCase()
    ) {
      return leftParsed.num - rightParsed.num;
    }

    return left.term.toLowerCase().localeCompare(right.term.toLowerCase());
  });
  return dataset;
}

function getDualPagePairs() {
  const cards = filterAndSortDatabaseRecords();
  const pagesList = [];
  pagesList.push({ type: "cover-front" });
  pagesList.push({ type: "index-page", sub: "left" });
  let cardIdx = 0;
  while (cardIdx < cards.length) {
    const pageObj = {
      type: "content-page",
      cards: [],
    };
    pageObj.cards.push(cards[cardIdx]);
    cardIdx++;
    if (cardIdx < cards.length) {
      pageObj.cards.push(cards[cardIdx]);
      cardIdx++;
    }
    pagesList.push(pageObj);
  }
  pagesList.push({ type: "cover-back" });
  return pagesList;
}

function renderDigitalBookState() {
  const list = getDualPagePairs();
  if (currentActiveViewPageIdx < 0) {
    currentActiveViewPageIdx = 0;
  }
  if (currentActiveViewPageIdx >= list.length) {
    currentActiveViewPageIdx = list.length - 1;
  }
  const currentSpread = list[currentActiveViewPageIdx];
  const paginationStatusEl = queryHTMLElementById("pagination-status");
  const itBookEl = queryHTMLElementById("it-book");
  const frontCoverEl = queryHTMLElementById("page-cover-front");
  const indexLeftPageEl = queryHTMLElementById("page-index-left");
  const indexRightPageEl = queryHTMLElementById("page-index-right");
  const dynamicTemplateLeftEl = queryHTMLElementById(
    "book-dynamic-template-left",
  );
  const dynamicTemplateRightEl = queryHTMLElementById(
    "book-dynamic-template-right",
  );
  const backCoverEl = queryHTMLElementById("page-cover-back");
  const prevBtn = queryHTMLElementById("book-prev-btn");
  const nextBtn = queryHTMLElementById("book-next-btn");

  if (itBookEl) {
    itBookEl.className = "it-book";
  }

  const bTempL = dynamicTemplateLeftEl.querySelectorAll(
    ".added-content-card audio",
  );
  bTempL.forEach((aud) => aud.pause());
  const bTempR = dynamicTemplateRightEl.querySelectorAll(
    ".added-content-card audio",
  );
  bTempR.forEach((aud) => aud.pause());
  frontCoverEl.style.display = "none";
  indexLeftPageEl.style.display = "none";
  indexRightPageEl.style.display = "none";
  dynamicTemplateLeftEl.style.display = "none";
  dynamicTemplateRightEl.style.display = "none";
  backCoverEl.style.display = "none";
  frontCoverEl.classList.remove("mobile-visible");
  indexLeftPageEl.classList.remove("mobile-visible");
  indexRightPageEl.classList.remove("mobile-visible");
  dynamicTemplateLeftEl.classList.remove("mobile-visible");
  dynamicTemplateRightEl.classList.remove("mobile-visible");
  backCoverEl.classList.remove("mobile-visible");
  prevBtn.disabled = currentActiveViewPageIdx === 0;
  nextBtn.disabled = currentActiveViewPageIdx === list.length - 1;
  if (currentSpread.type === "cover-front") {
    if (itBookEl) {
      itBookEl.classList.add("closed-front");
    }
    frontCoverEl.style.display = "block";
    frontCoverEl.style.transform = "rotateY(0deg)";
    frontCoverEl.classList.add("mobile-visible");
    paginationStatusEl.textContent = "FRONT COVER";
  } else if (currentSpread.type === "index-page") {
    indexLeftPageEl.style.display = "block";
    indexLeftPageEl.style.transform = "rotateY(0deg)";
    indexRightPageEl.style.display = "block";
    indexRightPageEl.style.transform = "rotateY(0deg)";
    indexLeftPageEl.classList.add("mobile-visible");
    renderIndexPageContent();
    paginationStatusEl.textContent = "GENERAL INDEX";
  } else if (currentSpread.type === "cover-back") {
    if (itBookEl) {
      itBookEl.classList.add("closed-back");
    }
    backCoverEl.style.display = "block";
    backCoverEl.style.transform = "rotateY(0deg)";
    backCoverEl.classList.add("mobile-visible");
    paginationStatusEl.textContent = "BACK COVER";
  } else if (currentSpread.type === "content-page") {
    const leftCard = currentSpread.cards[0];
    const rightCard = currentSpread.cards[1] || null;
    if (leftCard) {
      dynamicTemplateLeftEl.style.display = "block";
      dynamicTemplateLeftEl.style.transform = "rotateY(0deg)";
      dynamicTemplateLeftEl.classList.add("mobile-visible");
      renderSpecificCardData(
        leftCard,
        "left",
        currentActiveViewPageIdx * 2 - 1,
      );
    }
    if (rightCard) {
      dynamicTemplateRightEl.style.display = "block";
      dynamicTemplateRightEl.style.transform = "rotateY(0deg)";
      renderSpecificCardData(rightCard, "right", currentActiveViewPageIdx * 2);
    } else {
      dynamicTemplateRightEl.style.display = "block";
      dynamicTemplateRightEl.style.transform = "rotateY(0deg)";
      renderSpecificCardData(null, "right", currentActiveViewPageIdx * 2);
    }
    paginationStatusEl.textContent = "PAGE " + currentActiveViewPageIdx;
  }

  // Trigger 3D page flip transition styles for the newly shown pages
  const animatePageTurn = () => {
    // Detect page direction
    const direction =
      currentActiveViewPageIdx >= lastActiveViewPageIdx ? "right" : "left";
    lastActiveViewPageIdx = currentActiveViewPageIdx;

    const cleanAndAnimatePaper = (parentEl, animClass) => {
      if (!parentEl || parentEl.style.display === "none") return;
      const paper = parentEl.querySelector(".page-paper, .cover-design");
      if (paper) {
        paper.classList.remove(
          "paper-flip-left",
          "paper-flip-right",
          "paper-reveal-left",
          "paper-reveal-right",
        );
        void paper.offsetWidth; // Force Reflow
        paper.classList.add(animClass);
      }
    };

    const leftEls = [indexLeftPageEl, dynamicTemplateLeftEl, frontCoverEl];
    const rightEls = [indexRightPageEl, dynamicTemplateRightEl, backCoverEl];

    if (direction === "right") {
      // Going to the Right (Next Page): Left side page flips in from the right; Right side page is revealed from underneath.
      leftEls.forEach((el) => cleanAndAnimatePaper(el, "paper-flip-left"));
      rightEls.forEach((el) => cleanAndAnimatePaper(el, "paper-reveal-right"));
    } else {
      // Going to the Left (Prev Page): Right side page flips in from the left; Left side page is revealed from underneath.
      rightEls.forEach((el) => cleanAndAnimatePaper(el, "paper-flip-right"));
      leftEls.forEach((el) => cleanAndAnimatePaper(el, "paper-reveal-left"));
    }
  };
  animatePageTurn();
}

function renderIndexPageContent() {
  const leftIdxContainer = queryHTMLElementById("left-index-list");
  const shortcutButtonsRow = queryHTMLElementById("index-letter-shortcuts");
  if (shortcutButtonsRow) {
    const alphabetLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");
    shortcutButtonsRow.innerHTML = "";
    alphabetLetters.forEach((letra) => {
      const btn = document.createElement("button");
      btn.className = "idx-shortcut-btn";
      btn.textContent = letra;
      btn.addEventListener("click", () => {
        const searchBoxInput = queryHTMLElementById("terms-search");
        searchBoxInput.value = "";
        const pillsContainerButtons = queryAllHTMLElements(
          "#alphabet-pills .pill",
        );
        pillsContainerButtons.forEach((bi) => bi.classList.remove("active"));
        const finalIndexToJump = searchMatchingPillGroupForLetter(letra);
        if (finalIndexToJump) {
          finalIndexToJump.classList.add("active");
        }
        setTimeout(() => {
          navigateToFirstMatchingLetterPage(letra);
        }, 50);
      });
      shortcutButtonsRow.appendChild(btn);
    });
  }
  const filteredSortedItems = filterAndSortDatabaseRecords();
  leftIdxContainer.innerHTML = "";

  if (filteredSortedItems.length === 0) {
    const emptyNotice = document.createElement("p");
    emptyNotice.className = "empty-entries-alert-text";
    emptyNotice.textContent =
      "No registered pages found in the dictionary. Click '+ NEW PAGE' in the top-right corner to start your knowledge collection!";
    leftIdxContainer.appendChild(emptyNotice);
  } else {
    // Only list base pages in the general table of contents
    const indexPages = filteredSortedItems.filter((item) => !item.isCopy);
    if (indexPages.length === 0) {
      const emptyNotice = document.createElement("p");
      emptyNotice.className = "empty-entries-alert-text";
      emptyNotice.textContent =
        "No original entries match the filter criteria.";
      leftIdxContainer.appendChild(emptyNotice);
    } else {
      indexPages.forEach((item) => {
        const actualGlobalIdx = filteredSortedItems.findIndex(
          (x) => x.id === item.id,
        );
        const mappedGlobalSpreadIdx = Math.floor(actualGlobalIdx / 2) + 2;
        const pageOfEntry =
          actualGlobalIdx % 2 === 0
            ? mappedGlobalSpreadIdx * 2 - 1
            : mappedGlobalSpreadIdx * 2;

        // Find copies/replas for this base term to count total pages
        const parsed = parsePageTerm(item.term);
        const copies = filteredSortedItems.filter((p) => {
          const pParsed = parsePageTerm(p.term);
          return (
            pParsed.baseTerm.trim().toUpperCase() ===
            parsed.baseTerm.trim().toUpperCase()
          );
        });

        const count = copies.length;
        const countBadgeHTML =
          count > 1
            ? `<span class="idx-copy-badge" style="background-color: var(--accent-color); color: #fff; font-size: 0.65rem; padding: 1px 6px; border-radius: 9999px; margin-left: 6px; font-family: var(--mono-font); font-weight: bold; transform: scale(0.9); display: inline-block; vertical-align: middle;">${count} PGS</span>`
            : "";

        // Let's also collect unique media icons contained in this page and its copies
        const mediaTypes = new Set();
        copies.forEach((copy) => {
          if (copy.contents) {
            copy.contents.forEach((block) => {
              mediaTypes.add(block.type);
            });
          }
        });

        let mediaIconsHTML = "";
        if (mediaTypes.size > 0) {
          mediaIconsHTML +=
            '<span class="idx-media-icons-wrapper" style="margin-left: 10px; display: inline-flex; gap: 4px; align-items: center; opacity: 0.65; vertical-align: middle;">';
          mediaTypes.forEach((mType) => {
            let iconClass = "fa-solid fa-file";
            let color = "rgba(60, 40, 20, 0.4)";
            if (mType === "paragraph") {
              iconClass = "fa-solid fa-align-left";
              color = "#4b5563";
            } else if (mType === "image") {
              iconClass = "fa-solid fa-image";
              color = "#10b981";
            } else if (mType === "mindmap") {
              iconClass = "fa-solid fa-diagram-project";
              color = "#8b5cf6";
            } else if (mType === "pdf") {
              iconClass = "fa-solid fa-file-pdf";
              color = "#ef4444";
            } else if (mType === "audio") {
              iconClass = "fa-solid fa-microphone";
              color = "#f59e0b";
            } else if (mType === "video") {
              iconClass = "fa-solid fa-video";
              color = "#3b82f6";
            } else if (mType === "link") {
              iconClass = "fa-solid fa-link";
              color = "#06b6d4";
            } else if (mType === "file") {
              iconClass = "fa-solid fa-paperclip";
              color = "#ec4899";
            }

            mediaIconsHTML += `<i class="${iconClass}" style="font-size: 0.68rem; color: ${color};" title="${mType.toUpperCase()} module attached"></i>`;
          });
          mediaIconsHTML += "</span>";
        }

        const pageItemRow = document.createElement("div");
        pageItemRow.className = "index-item-row";
        pageItemRow.innerHTML = `
          <div style="display: flex; align-items: center; gap: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            <span class="idx-term-name">${item.term}</span>
            ${countBadgeHTML}
            ${mediaIconsHTML}
          </div>
          <span class="idx-page-indicator">PG. ${pageOfEntry}</span>
        `;
        pageItemRow.addEventListener("click", () => {
          currentActiveViewPageIdx = mappedGlobalSpreadIdx;
          triggerSynthesizedPageSound();
          renderDigitalBookState();
        });
        leftIdxContainer.appendChild(pageItemRow);
      });
    }
  }
}

function searchMatchingPillGroupForLetter(letra) {
  const codeValue = letra.charCodeAt(0);
  const pillsList = queryAllHTMLElements("#alphabet-pills .pill");
  if (letra === "#") {
    return Array.from(pillsList).find((bi) => bi.dataset.range === "nums");
  }
  let targetPillFound = null;
  pillsList.forEach((pill) => {
    const pillStr = pill.dataset.range;
    if (pillStr && pillStr.includes("-")) {
      const sections = pillStr.split("-");
      const firstSectionCode = sections[0].charCodeAt(0);
      const endSectionCode = sections[1].charCodeAt(0);
      if (codeValue >= firstSectionCode && codeValue <= endSectionCode) {
        targetPillFound = pill;
      }
    }
  });
  return targetPillFound || pillsList[0];
}

function navigateToFirstMatchingLetterPage(letra) {
  const filteredSortedList = filterAndSortDatabaseRecords();
  let firstMatchRelativeIdx = -1;
  for (let idx = 0; idx < filteredSortedList.length; idx++) {
    const page = filteredSortedList[idx];
    if (!page.isCopy && extractFirstAlphabeticalChar(page.term) === letra) {
      firstMatchRelativeIdx = idx;
      break;
    }
  }
  if (firstMatchRelativeIdx !== -1) {
    currentActiveViewPageIdx = Math.floor(firstMatchRelativeIdx / 2) + 2;
    triggerSynthesizedPageSound();
    renderDigitalBookState();
  } else {
    currentActiveViewPageIdx = 1;
    renderDigitalBookState();
  }
}

function renderSpecificCardData(cardData, sidePrefix, absolutePageLabelNumber) {
  const letterBadgeEl = queryHTMLElementById("dyn-letter-" + sidePrefix);
  const contentScopeContainer = queryHTMLElementById(
    "dyn-content-" + sidePrefix,
  );
  const footerTermContainer = queryHTMLElementById(
    "dyn-footer-term-" + sidePrefix,
  );
  const numberLeftLabel = queryHTMLElementById("dyn-num-" + sidePrefix);
  numberLeftLabel.textContent = "PG. " + absolutePageLabelNumber;

  // Reset styles to default state
  if (letterBadgeEl) {
    letterBadgeEl.style.color = "";
    letterBadgeEl.style.border = "";
    letterBadgeEl.style.padding = "";
    letterBadgeEl.style.fontSize = "";
    letterBadgeEl.style.fontWeight = "";
    letterBadgeEl.style.fontFamily = "";
    letterBadgeEl.style.letterSpacing = "";
  }
  if (footerTermContainer) {
    footerTermContainer.style.color = "";
    footerTermContainer.style.fontSize = "";
    footerTermContainer.style.fontWeight = "";
  }

  if (!cardData) {
    if (sidePrefix === "right") {
      letterBadgeEl.textContent = "...";
      footerTermContainer.textContent = "EMPTY";
      contentScopeContainer.innerHTML = `
        <div class="empty-class-box">
          <i class="fa-solid fa-book-open"></i>
          <p>This page is currently blank and ready inside the dictionary.</p>
        </div>
      `;
    }
    return;
  }
  const categoryLetterLabel = extractFirstAlphabeticalChar(cardData.term);
  const parsed = parsePageTerm(cardData.term);
  const isPredetermined = [
    "PDF",
    "EXCEL",
    "WORD",
    "PHOTO",
    "VIDEO",
    "LINK",
    "NOTE",
  ].includes(parsed.baseTerm.toUpperCase());

  if (isPredetermined) {
    // Show full name at the top (header) in black with no outline badge styling
    letterBadgeEl.textContent = cardData.term.toUpperCase();
    letterBadgeEl.style.color = "#1e293b";
    letterBadgeEl.style.border = "none";
    letterBadgeEl.style.padding = "0";
    letterBadgeEl.style.fontSize = "0.95rem";
    letterBadgeEl.style.fontWeight = "bold";
    letterBadgeEl.style.fontFamily = "var(--sans-font)";
    letterBadgeEl.style.letterSpacing = "0.05em";

    // Show full name at the bottom (footer) in black and bold
    footerTermContainer.textContent = cardData.term.toUpperCase();
    footerTermContainer.style.color = "#1e293b";
    footerTermContainer.style.fontSize = "0.8rem";
    footerTermContainer.style.fontWeight = "bold";
  } else {
    letterBadgeEl.textContent = categoryLetterLabel;
    footerTermContainer.textContent = cardData.term.toUpperCase();
  }
  let rawContentHTMLAccumulator = `
    <div class="class-content-area flex-column justify-between height-full">
      <h3 class="page-term-title" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%;">
        <span>${cardData.term}</span>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button class="edit-page-title-btn" title="Edit page title" onclick="editPageTitlePrompt('${cardData.id}')" style="background: rgba(148,163,184,0.15); color: #475569; border: 1px solid rgba(148,163,184,0.3); padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.75rem; display: flex; align-items: center; gap: 4px; font-weight: bold; font-family: var(--sans-font);">
            <i class="fa-solid fa-pen"></i> EDIT
          </button>
          ${
            cardData.id.startsWith("replica-")
              ? `
          <button class="delete-page-btn" title="Delete entire page from dictionary" onclick="openDeletePageModal('${cardData.id}')">
            <i class="fa-solid fa-trash-can"></i> DELETE
          </button>
          `
              : ""
          }
        </div>
      </h3>
      <div class="added-narratives-container" id="added-narrative-box-${cardData.id}">
  `;
  if (!cardData.contents || cardData.contents.length === 0) {
    rawContentHTMLAccumulator += `
      <div class="empty-class-box">
        <i class="fa-solid fa-ghost"></i>
        <p>No class materials registered for this page yet. Be the first to append documents, audio voice logs, or mind maps!</p>
      </div>
    `;
  } else {
    cardData.contents.forEach((block, idx) => {
      rawContentHTMLAccumulator += `
        <div class="added-content-card ${block.type}-card" data-block-index="${idx}">
          <div class="card-actions-wrapper" style="position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; z-index: 100;">
            <button class="card-edit-overlay-btn" title="Edit block content" onclick="editContentBlockFromCardPrompt('${cardData.id}', ${idx})" style="background: rgba(15, 23, 42, 0.7); color: #fff; border: 1px solid rgba(255,255,255,0.2); width: 26px; height: 26px; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s;">
              <i class="fa-solid fa-pen" style="font-size: 0.7rem;"></i>
            </button>
            <button class="card-deletion-overlay-btn" title="Delete block" onclick="deleteContentBlockFromCard('${cardData.id}', ${idx})" style="background: rgba(220, 38, 38, 0.85); color: #fff; border: none; width: 26px; height: 26px; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; position: static;">
              <i class="fa-solid fa-circle-minus" style="font-size: 0.75rem;"></i>
            </button>
          </div>
      `;
      if (block.type === "paragraph") {
        rawContentHTMLAccumulator += `
          <p class="text-narrative-paragraph">${safelyConvertStringToPlainMarkup(block.data)}</p>
        `;
      } else if (block.type === "image") {
        rawContentHTMLAccumulator += `
          <img src="${block.data}" alt="Apunte cargado" class="preview-clickable-image" onclick="expandImageModalView('${block.data.replace(/'/g, "\\'")}')">
          <span class="content-asset-label">// AUDIO / IMAGE SNAPSHOT ATTACHED</span>
        `;
      } else if (block.type === "mindmap") {
        rawContentHTMLAccumulator += `
          <img src="${block.data}" alt="Concept Diagram" class="preview-clickable-image canvas-render-sketch" onclick="expandImageModalView('${block.data.replace(/'/g, "\\'")}')">
          <span class="content-asset-label">// CONCEPT DIAGRAM: ACTIVE MIND MAP SKETCH</span>
        `;
      } else if (block.type === "pdf") {
        rawContentHTMLAccumulator += `
          <div class="custom-audio-bar flex align-center gap-15">
            <div class="pdf-icon-frame">
              <i class="fa-solid fa-file-pdf"></i>
            </div>
            <div class="pdf-meta-descr flex-grow">
              <h5>ACADEMIC HANDOUT (PDF)</h5>
              <p>${safelyConvertStringToPlainMarkup(block.name || "recurso_clase.pdf")}</p>
            </div>
            <button class="view-attached-pdf-btn" onclick="openEmbeddedPDFObject('${block.data.replace(/'/g, "\\'")}')">OPEN</button>
          </div>
        `;
      } else if (block.type === "audio") {
        rawContentHTMLAccumulator += `
          <div class="custom-audio-bar flex align-center gap-15">
            <button class="audio-trigger-playing-btn" onclick="triggerAudioPlaybackToggle(this, '${block.data}')">
              <i class="fa-solid fa-play"></i>
            </button>
            <div class="audio-progress-rail">
              <div class="audio-playback-fill"></div>
            </div>
            <span class="audio-timestamp-label">AUDIO VOICE LOG</span>
          </div>
        `;
      } else if (block.type === "video") {
        rawContentHTMLAccumulator += `
          <div style="width: 100%; margin-top: 5px;">
            <video src="${block.data}" controls style="max-height: 240px; border-radius: 6px; width: 100%; border: 1px solid rgba(255,255,255,0.1); background-color: #000; display: block;"></video>
            <span class="content-asset-label">// VIDEO ATTACHMENT (${safelyConvertStringToPlainMarkup(block.name || "video.mp4")})</span>
          </div>
        `;
      } else if (block.type === "link") {
        rawContentHTMLAccumulator += `
          <div class="custom-audio-bar flex align-center gap-15">
            <div class="pdf-icon-frame" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6; border-color: rgba(59, 130, 246, 0.3);">
              <i class="fa-solid fa-link"></i>
            </div>
            <div class="pdf-meta-descr flex-grow">
              <h5>EXTERNAL LINK</h5>
              <p>${safelyConvertStringToPlainMarkup(block.name || block.data)}</p>
            </div>
            <a href="${block.data}" target="_blank" class="view-attached-pdf-btn" style="background-color: #3b82f6; text-decoration: none; display: flex; align-items: center; justify-content: center; color: #fff;">VISIT</a>
          </div>
        `;
      } else if (block.type === "file") {
        rawContentHTMLAccumulator += `
          <div class="custom-audio-bar flex align-center gap-15">
            <div class="pdf-icon-frame" style="background: rgba(168, 85, 247, 0.15); color: #a855f7; border-color: rgba(168, 85, 247, 0.3);">
              <i class="${getFileIconClass(block.name)}"></i>
            </div>
            <div class="pdf-meta-descr flex-grow">
              <h5>${getFileTypeLabel(block.name)}</h5>
              <p>${safelyConvertStringToPlainMarkup(block.name || "document.bin")}</p>
            </div>
            <button class="view-attached-pdf-btn" style="background-color: #a855f7;" onclick="downloadDataUrlFile('${block.data.replace(/'/g, "\\'")}', '${block.name.replace(/'/g, "\\'")}')">DOWNLOAD</button>
          </div>
        `;
      }
      rawContentHTMLAccumulator += `</div>`;
    });
  }
  rawContentHTMLAccumulator += `
      </div>
      <div class="add-given-to-class-space">
        <button class="add-class-utility-btn" onclick="openGivenToClassWizardModal('${cardData.id}')">
          <i class="fa-solid fa-paperclip"></i> ADD CLASS MATERIALS
        </button>
      </div>
    </div>
  `;
  contentScopeContainer.innerHTML = rawContentHTMLAccumulator;
}

window.deleteContentBlockFromCard = function (cardId, contentIdx) {
  const foundCardObj = dbPages.find((page) => page.id === cardId);
  if (!foundCardObj || !foundCardObj.contents) return;
  foundCardObj.contents.splice(contentIdx, 1);
  persistDatabaseState();
  renderDigitalBookState();
};

window.editPageTitlePrompt = function (cardId) {
  const foundCardObj = dbPages.find((page) => page.id === cardId);
  if (!foundCardObj) return;
  const newTitle = prompt(
    "Editar Título / Término de la Página:",
    foundCardObj.term,
  );
  if (newTitle && newTitle.trim()) {
    foundCardObj.term = newTitle.trim();
    persistDatabaseState();
    renderDigitalBookState();
  }
};

window.editContentBlockFromCardPrompt = function (cardId, contentIdx) {
  const foundCardObj = dbPages.find((page) => page.id === cardId);
  if (!foundCardObj || !foundCardObj.contents) return;
  const block = foundCardObj.contents[contentIdx];
  if (!block) return;

  if (block.type === "paragraph") {
    const newText = prompt("Editar contenido del párrafo:", block.data);
    if (newText !== null && newText.trim() !== "") {
      block.data = newText.trim();
      persistDatabaseState();
      renderDigitalBookState();
    }
  } else if (block.type === "link") {
    const newUrl = prompt("Editar URL del enlace:", block.data);
    if (newUrl !== null && newUrl.trim() !== "") {
      const newName = prompt(
        "Editar descripción / título del enlace:",
        block.name || newUrl,
      );
      block.data = newUrl.trim();
      block.name = newName ? newName.trim() : null;
      persistDatabaseState();
      renderDigitalBookState();
    }
  } else {
    const newName = prompt(
      "Editar etiqueta / descripción del archivo:",
      block.name || "",
    );
    if (newName !== null) {
      block.name = newName.trim();
      persistDatabaseState();
      renderDigitalBookState();
    }
  }
};

window.expandImageModalView = function (imgBlobSource) {
  const viewModal = queryHTMLElementById("mindmap-fullscreen-view-modal");
  const previewImgEl = queryHTMLElementById("fullscreen-view-img");
  previewImgEl.src = imgBlobSource;
  viewModal.classList.remove("hidden");
};

window.openEmbeddedPDFObject = function (pdfDataUrl) {
  const fileReaderDownloadStream = document.createElement("a");
  fileReaderDownloadStream.href = pdfDataUrl;
  fileReaderDownloadStream.download = "apuntes_clase.pdf";
  document.body.appendChild(fileReaderDownloadStream);
  fileReaderDownloadStream.click();
  document.body.removeChild(fileReaderDownloadStream);
};

window.triggerAudioPlaybackToggle = function (btnElement, audioSourceDataUrl) {
  const iconEl = btnElement.querySelector("i");
  let activeAudioItem = btnElement.audioPlaybackEngine;
  if (!activeAudioItem) {
    activeAudioItem = new Audio(audioSourceDataUrl);
    btnElement.audioPlaybackEngine = activeAudioItem;
    activeAudioItem.addEventListener("timeupdate", () => {
      const percentRatio =
        (activeAudioItem.currentTime / activeAudioItem.duration) * 100;
      const progressFillEl = btnElement.parentElement.querySelector(
        ".audio-playback-fill",
      );
      if (progressFillEl) {
        progressFillEl.style.width = percentRatio + "%";
      }
    });
    activeAudioItem.addEventListener("ended", () => {
      iconEl.className = "fa-solid fa-play";
      const progressFillEl = btnElement.parentElement.querySelector(
        ".audio-playback-fill",
      );
      if (progressFillEl) progressFillEl.style.width = "0%";
    });
  }
  if (activeAudioItem.paused) {
    const parentGlobalNode = dynamicTemplateRightEl;
    const allPlayingButtons = document.querySelectorAll(
      ".audio-trigger-playing-btn",
    );
    allPlayingButtons.forEach((playingBtn) => {
      if (playingBtn !== btnElement && playingBtn.audioPlaybackEngine) {
        playingBtn.audioPlaybackEngine.pause();
        playingBtn.querySelector("i").className = "fa-solid fa-play";
      }
    });
    activeAudioItem.play();
    iconEl.className = "fa-solid fa-pause";
  } else {
    activeAudioItem.pause();
    iconEl.className = "fa-solid fa-play";
  }
};

function safelyConvertStringToPlainMarkup(htmlStr) {
  if (!htmlStr) return "";
  return htmlStr
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildAlphabetPillsListeners() {
  const pills = queryAllHTMLElements("#alphabet-pills .pill");
  pills.forEach((btn) => {
    btn.addEventListener("click", () => {
      pills.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentActiveViewPageIdx = 1;
      renderDigitalBookState();
    });
  });
  queryHTMLElementById("terms-search").addEventListener("input", () => {
    const clearButtonEl = queryHTMLElementById("clear-search");
    if (queryHTMLElementById("terms-search").value.trim() !== "") {
      clearButtonEl.style.display = "block";
    } else {
      clearButtonEl.style.display = "none";
    }
    currentActiveViewPageIdx = 1;
    renderDigitalBookState();
  });
  queryHTMLElementById("clear-search").addEventListener("click", () => {
    queryHTMLElementById("terms-search").value = "";
    queryHTMLElementById("clear-search").style.display = "none";
    currentActiveViewPageIdx = 1;
    renderDigitalBookState();
  });
}

function buildCentralBookNavigationListeners() {
  const prevBtn = queryHTMLElementById("book-prev-btn");
  const nextBtn = queryHTMLElementById("book-next-btn");
  const startReadingBtn = queryHTMLElementById("start-reading-btn");
  const closeBookBtn = queryHTMLElementById("close-book-btn");

  prevBtn.addEventListener("click", () => {
    if (currentActiveViewPageIdx > 0) {
      currentActiveViewPageIdx--;
      triggerSynthesizedPageSound();
      renderDigitalBookState();
    }
  });
  nextBtn.addEventListener("click", () => {
    const list = getDualPagePairs();
    if (currentActiveViewPageIdx < list.length - 1) {
      currentActiveViewPageIdx++;
      triggerSynthesizedPageSound();
      renderDigitalBookState();
    }
  });
  startReadingBtn.addEventListener("click", () => {
    currentActiveViewPageIdx = 1;
    triggerSynthesizedPageSound();
    renderDigitalBookState();
  });
  closeBookBtn.addEventListener("click", () => {
    currentActiveViewPageIdx = 0;
    triggerSynthesizedPageSound();
    renderDigitalBookState();
  });
  document.addEventListener("keydown", (evt) => {
    const isModalOpenFlag = document.querySelector(".modal:not(.hidden)");
    if (isModalOpenFlag) return;
    if (evt.key === "ArrowLeft") {
      prevBtn.click();
    } else if (evt.key === "ArrowRight") {
      nextBtn.click();
    }
  });
}

function buildGeneralModalsStateHandlers() {
  const addPageBtn = queryHTMLElementById("add-page-btn");
  const addEntryModal = queryHTMLElementById("add-entry-modal");
  const closeAddModal = queryHTMLElementById("close-add-modal");
  const cancelAddModal = queryHTMLElementById("cancel-add-modal");
  const addEntryForm = queryHTMLElementById("add-entry-form");
  const newTermInput = queryHTMLElementById("new-term-input");

  if (addPageBtn) {
    addPageBtn.addEventListener("click", () => {
      newTermInput.value = "";
      addEntryModal.classList.remove("hidden");
      setTimeout(() => {
        newTermInput.focus();
      }, 100);
    });
  }

  const hideCreatorModal = () => {
    if (addEntryModal) addEntryModal.classList.add("hidden");
  };

  if (closeAddModal) closeAddModal.addEventListener("click", hideCreatorModal);
  if (cancelAddModal)
    cancelAddModal.addEventListener("click", hideCreatorModal);

  if (addEntryForm) {
    addEntryForm.addEventListener("submit", (evt) => {
      evt.preventDefault();
      const cleanProposedTitle = newTermInput.value.trim();
      if (!cleanProposedTitle) return;
      const sameTermAlreadyExists = dbPages.find(
        (item) => item.term.toLowerCase() === cleanProposedTitle.toLowerCase(),
      );
      if (sameTermAlreadyExists) {
        alert("This term already exists in the dictionary.");
        return;
      }
      const newEntryObj = {
        id:
          "replica-" +
          cleanProposedTitle.toLowerCase().replace(/[^a-zA-Z0-9]/g, "-") +
          "-" +
          generateUniqueId(),
        term: cleanProposedTitle,
        contents: [],
      };

      dbPages.push(newEntryObj);
      persistDatabaseState();

      hideCreatorModal();
      const updatedCategorizedList = filterAndSortDatabaseRecords();
      const matchingCardIdx = updatedCategorizedList.findIndex(
        (item) => item.id === newEntryObj.id,
      );
      if (matchingCardIdx !== -1) {
        currentActiveViewPageIdx = Math.floor(matchingCardIdx / 2) + 2;
      } else {
        currentActiveViewPageIdx = 1;
      }
      renderDigitalBookState();
    });
  }
  const quickStatsBtn = queryHTMLElementById("quick-stats-btn");
  const statsSummaryModal = queryHTMLElementById("stats-summary-modal");
  const closeStatsModal = queryHTMLElementById("close-stats-modal");
  quickStatsBtn.addEventListener("click", () => {
    calculateAndShowStatisticsGraphAndCounters();
    statsSummaryModal.classList.remove("hidden");
  });
  closeStatsModal.addEventListener("click", () => {
    statsSummaryModal.classList.add("hidden");
  });
  queryHTMLElementById("close-fullscreen-view-btn").addEventListener(
    "click",
    () => {
      queryHTMLElementById("mindmap-fullscreen-view-modal").classList.add(
        "hidden",
      );
    },
  );
  queryHTMLElementById("theme-toggle").addEventListener("click", () => {
    document.body.classList.toggle("vintage-theme");
  });
  queryHTMLElementById("sound-toggle").addEventListener("click", () => {
    activeSoundEffectsConfig = !activeSoundEffectsConfig;
    const iconBtn = queryHTMLElement("#sound-toggle i");
    if (activeSoundEffectsConfig) {
      iconBtn.className = "fa-solid fa-volume-high";
    } else {
      iconBtn.className = "fa-solid fa-volume-xmark";
    }
  });

  // Delete page modal handlers
  const deletePageModal = queryHTMLElementById("delete-page-modal");
  const closeDeleteModal = queryHTMLElementById("close-delete-modal");
  const cancelDeleteModal = queryHTMLElementById("cancel-delete-modal");
  const confirmDeleteModalBtn = queryHTMLElementById(
    "confirm-delete-modal-btn",
  );

  const hideDeleteModal = () => {
    if (deletePageModal) {
      deletePageModal.classList.add("hidden");
    }
    activePageDeletionTargetId = null;
  };

  if (closeDeleteModal)
    closeDeleteModal.addEventListener("click", hideDeleteModal);
  if (cancelDeleteModal)
    cancelDeleteModal.addEventListener("click", hideDeleteModal);

  if (confirmDeleteModalBtn) {
    confirmDeleteModalBtn.addEventListener("click", () => {
      if (!activePageDeletionTargetId) return;
      const targetIdx = dbPages.findIndex(
        (page) => page.id === activePageDeletionTargetId,
      );
      if (targetIdx !== -1) {
        dbPages.splice(targetIdx, 1);
        persistDatabaseState();
      }
      hideDeleteModal();

      const list = getDualPagePairs();
      if (currentActiveViewPageIdx >= list.length) {
        currentActiveViewPageIdx = Math.max(0, list.length - 1);
      }
      renderDigitalBookState();
    });
  }

  // Letters Search Modal open/close handlers
  const openLettersBtn = queryHTMLElementById("open-letters-search-btn");
  const lettersModal = queryHTMLElementById("letters-search-modal");
  const closeLettersModal = queryHTMLElementById("close-letters-modal");

  if (openLettersBtn && lettersModal) {
    openLettersBtn.addEventListener("click", () => {
      lettersModal.classList.remove("hidden");
    });
  }
  if (closeLettersModal && lettersModal) {
    closeLettersModal.addEventListener("click", () => {
      lettersModal.classList.add("hidden");
    });
  }
  if (lettersModal) {
    lettersModal
      .querySelector(".modal-backdrop")
      ?.addEventListener("click", () => {
        lettersModal.classList.add("hidden");
      });
  }

  // Add PDF / Documentation Modal handlers
  const addDocBtn = queryHTMLElementById("add-doc-page-btn");
  const addDocModal = queryHTMLElementById("add-doc-entry-modal");
  const closeAddDocModal = queryHTMLElementById("close-add-doc-modal");
  const cancelAddDocModal = queryHTMLElementById("cancel-add-doc-modal");
  const addDocForm = queryHTMLElementById("add-doc-entry-form");

  const docTermInput = queryHTMLElementById("doc-term-input");
  const docContentInput = queryHTMLElementById("doc-content-input");
  const docPdfFileInput = queryHTMLElementById("doc-pdf-file-input");
  const docPdfDropzone = queryHTMLElementById("doc-pdf-dropzone");
  const docPdfUploadPreview = queryHTMLElementById("doc-pdf-upload-preview");
  const docPdfPreviewFilename = queryHTMLElementById(
    "doc-pdf-preview-filename",
  );

  let uploadedDocPdfData = null;

  if (addDocBtn && addDocModal) {
    addDocBtn.addEventListener("click", () => {
      if (docTermInput) docTermInput.value = "";
      if (docContentInput) docContentInput.value = "";
      if (docPdfFileInput) docPdfFileInput.value = "";
      const docLinkInput = queryHTMLElementById("doc-link-input");
      if (docLinkInput) docLinkInput.value = "";
      uploadedDocPdfData = null;

      if (docPdfUploadPreview) docPdfUploadPreview.classList.add("hidden");
      if (docPdfDropzone) {
        const promptEl = docPdfDropzone.querySelector(".dropzone-prompt");
        if (promptEl) promptEl.classList.remove("hidden");
      }

      addDocModal.classList.remove("hidden");
      setTimeout(() => {
        if (docTermInput) docTermInput.focus();
      }, 100);
    });
  }

  const hideDocModal = () => {
    if (addDocModal) addDocModal.classList.add("hidden");
  };

  if (closeAddDocModal)
    closeAddDocModal.addEventListener("click", hideDocModal);
  if (cancelAddDocModal)
    cancelAddDocModal.addEventListener("click", hideDocModal);
  if (addDocModal) {
    addDocModal
      .querySelector(".modal-backdrop")
      ?.addEventListener("click", hideDocModal);
  }

  if (docPdfDropzone) {
    docPdfDropzone.addEventListener("click", () => {
      if (docPdfFileInput) docPdfFileInput.click();
    });

    docPdfDropzone.addEventListener("dragover", (evt) => {
      evt.preventDefault();
      docPdfDropzone.classList.add("drag-over");
    });

    docPdfDropzone.addEventListener("dragleave", () => {
      docPdfDropzone.classList.remove("drag-over");
    });

    docPdfDropzone.addEventListener("drop", (evt) => {
      evt.preventDefault();
      docPdfDropzone.classList.remove("drag-over");
      if (evt.dataTransfer.files && evt.dataTransfer.files[0]) {
        handleDocPdfFile(evt.dataTransfer.files[0]);
      }
    });
  }

  if (docPdfFileInput) {
    docPdfFileInput.addEventListener("change", () => {
      if (docPdfFileInput.files && docPdfFileInput.files[0]) {
        handleDocPdfFile(docPdfFileInput.files[0]);
      }
    });
  }

  function handleDocPdfFile(fileLocalRef) {
    const binaryReader = new FileReader();
    binaryReader.onload = (evt) => {
      uploadedDocPdfData = {
        name: fileLocalRef.name,
        data: evt.target.result,
      };
      if (docPdfPreviewFilename)
        docPdfPreviewFilename.textContent = fileLocalRef.name;
      if (docPdfDropzone) {
        const promptEl = docPdfDropzone.querySelector(".dropzone-prompt");
        if (promptEl) promptEl.classList.add("hidden");
      }
      if (docPdfUploadPreview) docPdfUploadPreview.classList.remove("hidden");
    };
    binaryReader.readAsDataURL(fileLocalRef);
  }

  if (addDocForm) {
    addDocForm.addEventListener("submit", async (evt) => {
      evt.preventDefault();

      const docLinkInput = queryHTMLElementById("doc-link-input");
      const linkValue = docLinkInput ? docLinkInput.value.trim() : "";
      const textContentValue = docContentInput
        ? docContentInput.value.trim()
        : "";

      if (!uploadedDocPdfData && !linkValue && !textContentValue) {
        alert(
          "Please provide at least one resource to upload (a file, a URL link, or written notes).",
        );
        return;
      }

      let lastTargetPageId = null;

      if (uploadedDocPdfData) {
        const fileType = detectFileType(uploadedDocPdfData.name);
        lastTargetPageId = await addContentBlockToPredeterminedPage(
          fileType,
          uploadedDocPdfData.data,
          uploadedDocPdfData.name,
        );
      }

      if (linkValue) {
        lastTargetPageId = await addContentBlockToPredeterminedPage(
          "link",
          linkValue,
          linkValue,
        );
      }

      if (textContentValue) {
        lastTargetPageId = await addContentBlockToPredeterminedPage(
          "paragraph",
          textContentValue,
        );
      }

      hideDocModal();

      // Navigate to the respective page inside the book
      if (lastTargetPageId) {
        const updatedCategorizedList = filterAndSortDatabaseRecords();
        const matchingCardIdx = updatedCategorizedList.findIndex(
          (item) => item.id === lastTargetPageId,
        );
        if (matchingCardIdx !== -1) {
          currentActiveViewPageIdx = Math.floor(matchingCardIdx / 2) + 2;
        }
      }

      triggerSynthesizedPageSound();
      renderDigitalBookState();
    });
  }
}

window.openDeletePageModal = function (cardId) {
  const targetCard = dbPages.find((page) => page.id === cardId);
  if (!targetCard) return;
  activePageDeletionTargetId = cardId;
  const titleDisplay = queryHTMLElementById("delete-page-title");
  if (titleDisplay) {
    titleDisplay.textContent = `"${targetCard.term}"`;
  }
  const deletePageModal = queryHTMLElementById("delete-page-modal");
  if (deletePageModal) {
    deletePageModal.classList.remove("hidden");
  }
};

window.openGivenToClassWizardModal = function (cardId) {
  activePageAttachmentTargetId = cardId;
  const targetCard = dbPages.find((page) => page.id === cardId);
  if (!targetCard) return;
  queryHTMLElementById("target-page-title-label").textContent =
    "PAGE: " + targetCard.term.toUpperCase();
  const selectGrid = queryHTMLElement(".class-content-selector-grid");
  selectGrid.style.display = "grid";
  queryHTMLElementById("wizard-paragraph-step").classList.add("hidden");
  queryHTMLElementById("wizard-image-step").classList.add("hidden");
  queryHTMLElementById("wizard-audio-step").classList.add("hidden");
  queryHTMLElementById("wizard-pdf-step").classList.add("hidden");
  const wizardLinkStep = queryHTMLElementById("wizard-link-step");
  if (wizardLinkStep) wizardLinkStep.classList.add("hidden");
  queryHTMLElementById("add-class-content-modal").classList.remove("hidden");
};

function buildWizardUploaderStepHandlers() {
  const classModal = queryHTMLElementById("add-class-content-modal");
  const closeClassModalBtn = queryHTMLElementById("close-class-modal");
  const selectionCards = queryAllHTMLElements(".selection-card");
  const selectGrid = queryHTMLElement(".class-content-selector-grid");
  const wizardParagraphStep = queryHTMLElementById("wizard-paragraph-step");
  const wizardImageStep = queryHTMLElementById("wizard-image-step");
  const wizardAudioStep = queryHTMLElementById("wizard-audio-step");
  const wizardPdfStep = queryHTMLElementById("wizard-pdf-step");
  const wizardLinkStep = queryHTMLElementById("wizard-link-step");

  closeClassModalBtn.addEventListener("click", () => {
    classModal.classList.add("hidden");
    exitSimulatedAudioRecordingSession();
  });
  selectionCards.forEach((card) => {
    card.addEventListener("click", () => {
      const cType = card.dataset.contentType;
      selectGrid.style.display = "none";
      if (cType === "paragraph") {
        queryHTMLElementById("step-paragraph-text").value = "";
        wizardParagraphStep.classList.remove("hidden");
      } else if (cType === "mindmap") {
        classModal.classList.add("hidden");
        triggerMindMapDrawingCanvasModule(activePageAttachmentTargetId);
      } else if (cType === "image") {
        resetDropzoneArea("image");
        wizardImageStep.classList.remove("hidden");
      } else if (cType === "audio") {
        resetAudioWizardSpace();
        wizardAudioStep.classList.remove("hidden");
      } else if (cType === "pdf") {
        resetDropzoneArea("pdf");
        wizardPdfStep.classList.remove("hidden");
      } else if (cType === "link") {
        if (queryHTMLElementById("step-link-title"))
          queryHTMLElementById("step-link-title").value = "";
        if (queryHTMLElementById("step-link-url"))
          queryHTMLElementById("step-link-url").value = "";
        if (wizardLinkStep) wizardLinkStep.classList.remove("hidden");
      }
    });
  });
  const backButtons = queryAllHTMLElements(".wizard-back-btn");
  backButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      wizardParagraphStep.classList.add("hidden");
      wizardImageStep.classList.add("hidden");
      wizardAudioStep.classList.add("hidden");
      wizardPdfStep.classList.add("hidden");
      if (wizardLinkStep) wizardLinkStep.classList.add("hidden");
      selectGrid.style.display = "grid";
      exitSimulatedAudioRecordingSession();
    });
  });
  queryHTMLElementById("confirm-paragraph-btn").addEventListener(
    "click",
    async () => {
      const txtVal = queryHTMLElementById("step-paragraph-text").value.trim();
      if (!txtVal) return;
      const targetPageId = await addContentBlockToTargetPage(
        activePageAttachmentTargetId,
        "paragraph",
        txtVal,
      );
      classModal.classList.add("hidden");

      // Auto navigate to the page
      const updatedCategorizedList = filterAndSortDatabaseRecords();
      const matchingCardIdx = updatedCategorizedList.findIndex(
        (item) => item.id === targetPageId,
      );
      if (matchingCardIdx !== -1) {
        currentActiveViewPageIdx = Math.floor(matchingCardIdx / 2) + 2;
      }
      renderDigitalBookState();
    },
  );
  queryHTMLElementById("confirm-image-btn").addEventListener(
    "click",
    async () => {
      if (!temporalAttachmentContainer) {
        alert("No valid image resource has been loaded.");
        return;
      }
      const targetPageId = await addContentBlockToTargetPage(
        activePageAttachmentTargetId,
        "image",
        temporalAttachmentContainer,
      );
      classModal.classList.add("hidden");

      // Auto navigate to the page
      const updatedCategorizedList = filterAndSortDatabaseRecords();
      const matchingCardIdx = updatedCategorizedList.findIndex(
        (item) => item.id === targetPageId,
      );
      if (matchingCardIdx !== -1) {
        currentActiveViewPageIdx = Math.floor(matchingCardIdx / 2) + 2;
      }
      renderDigitalBookState();
    },
  );
  queryHTMLElementById("confirm-pdf-btn").addEventListener(
    "click",
    async () => {
      if (!temporalAttachmentContainer) {
        alert("Please attach a file resource to confirm.");
        return;
      }
      const fileType = detectFileType(temporalAttachmentContainer.name);
      const targetPageId = await addContentBlockToTargetPage(
        activePageAttachmentTargetId,
        fileType,
        temporalAttachmentContainer.data,
        temporalAttachmentContainer.name,
      );
      classModal.classList.add("hidden");

      // Auto navigate to the page
      const updatedCategorizedList = filterAndSortDatabaseRecords();
      const matchingCardIdx = updatedCategorizedList.findIndex(
        (item) => item.id === targetPageId,
      );
      if (matchingCardIdx !== -1) {
        currentActiveViewPageIdx = Math.floor(matchingCardIdx / 2) + 2;
      }
      renderDigitalBookState();
    },
  );
  if (queryHTMLElementById("confirm-link-btn")) {
    queryHTMLElementById("confirm-link-btn").addEventListener(
      "click",
      async () => {
        const urlVal = queryHTMLElementById("step-link-url").value.trim();
        if (!urlVal) {
          alert("Please enter a valid website URL.");
          return;
        }
        let titleVal = queryHTMLElementById("step-link-title").value.trim();
        if (!titleVal) {
          titleVal = urlVal;
        }
        const targetPageId = await addContentBlockToTargetPage(
          activePageAttachmentTargetId,
          "link",
          urlVal,
          titleVal,
        );
        classModal.classList.add("hidden");

        // Auto navigate to the page
        const updatedCategorizedList = filterAndSortDatabaseRecords();
        const matchingCardIdx = updatedCategorizedList.findIndex(
          (item) => item.id === targetPageId,
        );
        if (matchingCardIdx !== -1) {
          currentActiveViewPageIdx = Math.floor(matchingCardIdx / 2) + 2;
        }
        renderDigitalBookState();
      },
    );
  }
  queryHTMLElementById("confirm-audio-btn").addEventListener(
    "click",
    async () => {
      if (!temporalAttachmentContainer) {
        alert("Please record or upload a voice resource.");
        return;
      }
      const targetPageId = await addContentBlockToTargetPage(
        activePageAttachmentTargetId,
        "audio",
        temporalAttachmentContainer,
      );
      classModal.classList.add("hidden");

      // Auto navigate to the page
      const updatedCategorizedList = filterAndSortDatabaseRecords();
      const matchingCardIdx = updatedCategorizedList.findIndex(
        (item) => item.id === targetPageId,
      );
      if (matchingCardIdx !== -1) {
        currentActiveViewPageIdx = Math.floor(matchingCardIdx / 2) + 2;
      }
      renderDigitalBookState();
    },
  );
  setupDropzoneHandlers(
    "image-dropzone",
    "image-file-input",
    "image-upload-preview",
    "image",
  );
  setupDropzoneHandlers(
    "pdf-dropzone",
    "pdf-file-input",
    "pdf-upload-preview",
    "pdf",
  );
  setupAudioWizardRecordingHandlers();
}

function resetDropzoneArea(tipo) {
  temporalAttachmentContainer = null;
  const inputEl = queryHTMLElementById(tipo + "-file-input");
  inputEl.value = "";
  const previewDiv = queryHTMLElementById(tipo + "-upload-preview");
  previewDiv.classList.add("hidden");
  const promptDiv = previewDiv.parentElement.querySelector(".dropzone-prompt");
  promptDiv.classList.remove("hidden");
}

function setupDropzoneHandlers(zoneId, inputId, previewId, tipo) {
  const dropzoneEl = queryHTMLElementById(zoneId);
  const inputEl = queryHTMLElementById(inputId);
  const previewEl = queryHTMLElementById(previewId);
  const promptEl = dropzoneEl.querySelector(".dropzone-prompt");
  dropzoneEl.addEventListener("click", () => {
    inputEl.click();
  });
  dropzoneEl.addEventListener("dragover", (evt) => {
    evt.preventDefault();
    dropzoneEl.classList.add("drag-over");
  });
  dropzoneEl.addEventListener("dragleave", () => {
    dropzoneEl.classList.remove("drag-over");
  });
  dropzoneEl.addEventListener("drop", (evt) => {
    evt.preventDefault();
    dropzoneEl.classList.remove("drag-over");
    if (evt.dataTransfer.files && evt.dataTransfer.files[0]) {
      processFileUploaderDropzoneStream(
        evt.dataTransfer.files[0],
        previewEl,
        promptEl,
        tipo,
      );
    }
  });
  inputEl.addEventListener("change", () => {
    if (inputEl.files && inputEl.files[0]) {
      processFileUploaderDropzoneStream(
        inputEl.files[0],
        previewEl,
        promptEl,
        tipo,
      );
    }
  });
}

function processFileUploaderDropzoneStream(
  fileLocalRef,
  previewEl,
  promptEl,
  tipo,
) {
  const binaryReader = new FileReader();
  binaryReader.onload = (evt) => {
    if (tipo === "image") {
      temporalAttachmentContainer = evt.target.result;
      const thumbEl = previewEl.querySelector("img");
      thumbEl.src = evt.target.result;
      previewEl.querySelector(".preview-filename").textContent =
        fileLocalRef.name;
    } else if (tipo === "pdf") {
      temporalAttachmentContainer = {
        name: fileLocalRef.name,
        data: evt.target.result,
      };
      previewEl.querySelector(".preview-filename").textContent =
        fileLocalRef.name;
    } else if (tipo === "audio") {
      temporalAttachmentContainer = evt.target.result;
      previewEl.querySelector(".preview-filename").textContent =
        fileLocalRef.name;
    }
    promptEl.classList.add("hidden");
    previewEl.classList.remove("hidden");
  };
  binaryReader.readAsDataURL(fileLocalRef);
}

function resetAudioWizardSpace() {
  temporalAttachmentContainer = null;
  resetDropzoneArea("audio");
}

function setupAudioWizardRecordingHandlers() {
  setupDropzoneHandlers(
    "audio-dropzone",
    "audio-file-input",
    "audio-upload-preview",
    "audio",
  );
}

function fluctuateWaveformPillarHeights() {
  const bars = queryAllHTMLElements("#visualizer-bars .bar");
  bars.forEach((barEl) => {
    const randomPercentValue = Math.floor(Math.random() * 26) + 10;
    barEl.style.height = randomPercentValue + "px";
  });
}

function calculatePlayDurationLayoutAndPaddings(secsVal) {
  const currentMins = Math.floor(secsVal / 60);
  const remainingSecs = secsVal % 60;
  return (
    String(currentMins).padStart(2, "0") +
    ":" +
    String(remainingSecs).padStart(2, "0")
  );
}

function exitSimulatedAudioRecordingSession() {
  isAudioRecordingActiveState = false;
  clearInterval(simulatedVoiceRecorderIntervalId);
  const btnStart = queryHTMLElementById("btn-start-record");
  if (btnStart) btnStart.classList.remove("hidden");
  const btnStop = queryHTMLElementById("btn-stop-record");
  if (btnStop) btnStop.classList.add("hidden");
  const pulse = queryHTMLElementById("visualizer-pulse");
  if (pulse) pulse.classList.remove("animating");
  const barsContainer = queryHTMLElementById("visualizer-bars");
  if (barsContainer) barsContainer.classList.remove("visualizing");
  const indicator = queryHTMLElementById("audio-recording-global-indicator");
  if (indicator) indicator.classList.add("hidden");
  const bars = queryAllHTMLElements("#visualizer-bars .bar");
  bars.forEach((barEl) => (barEl.style.height = "10px"));
}

function synthesizeOfflineAudioPayload() {
  try {
    if (!audioContextInstance) {
      audioContextInstance = new (
        window.AudioContext || window.webkitAudioContext
      )();
    }
    const frameRateRatio = audioContextInstance.sampleRate;
    const soundSecondsDuration = Math.max(1, voiceRecordingDurationSeconds);
    const audioChannelBuffer = audioContextInstance.createBuffer(
      1,
      frameRateRatio * soundSecondsDuration,
      frameRateRatio,
    );
    const outputChannel = audioChannelBuffer.getChannelData(0);
    const acousticMelodyHz = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63]; // C4, E4, G4, C5 (C Major chime)
    for (let pointIdx = 0; pointIdx < audioChannelBuffer.length; pointIdx++) {
      const t = pointIdx / frameRateRatio;
      const noteDuration = 0.65; // Each beautiful note lasts 0.65 seconds
      const noteIndex = Math.floor(t / noteDuration) % acousticMelodyHz.length;
      const baseFreq = acousticMelodyHz[noteIndex];
      const noteTime = t % noteDuration;

      // Smooth exponential decay profile for a music box/harp effect
      const noteVolDecay = Math.exp(-4.5 * noteTime);

      // Soft pleasant acoustic sine wave with organic warmth (harmonics)
      const mainTone = Math.sin(2 * Math.PI * baseFreq * t);
      const firstOvertone = Math.sin(2 * Math.PI * (baseFreq * 2) * t) * 0.45;
      const secondOvertone = Math.sin(2 * Math.PI * (baseFreq * 3) * t) * 0.15;

      // Global fade filter to avoid clicks at the beginning/end of recording
      const globalEnvelope = Math.sin(
        (pointIdx * Math.PI) / audioChannelBuffer.length,
      );

      outputChannel[pointIdx] =
        (mainTone + firstOvertone + secondOvertone) *
        noteVolDecay *
        globalEnvelope *
        0.25;
    }
    temporalAttachmentContainer =
      convertAudioBufferToWavDataUrl(audioChannelBuffer);
    const playbackElement = queryHTMLElementById("recorded-audio-element");
    playbackElement.src = temporalAttachmentContainer;
    queryHTMLElementById("recording-playback-space").classList.remove("hidden");
  } catch (err) {}
}

function convertAudioBufferToWavDataUrl(audioBuffer) {
  const totalChannelsCount = 1;
  const originalBitDepth = 16;
  const chunkHeaderBytes = 44;
  const payloadBuffer = new ArrayBuffer(
    chunkHeaderBytes + audioBuffer.length * 2,
  );
  const dataViewStream = new DataView(payloadBuffer);
  writeAsciiCharactersIntoBufferView(dataViewStream, 0, "RIFF");
  dataViewStream.setUint32(4, 36 + audioBuffer.length * 2, true);
  writeAsciiCharactersIntoBufferView(dataViewStream, 8, "WAVE");
  writeAsciiCharactersIntoBufferView(dataViewStream, 12, "fmt ");
  dataViewStream.setUint32(16, 16, true);
  dataViewStream.setUint16(20, 1, true);
  dataViewStream.setUint16(22, totalChannelsCount, true);
  dataViewStream.setUint32(24, audioBuffer.sampleRate, true);
  dataViewStream.setUint32(28, audioBuffer.sampleRate * 2, true);
  dataViewStream.setUint16(32, 2, true);
  dataViewStream.setUint16(34, originalBitDepth, true);
  writeAsciiCharactersIntoBufferView(dataViewStream, 36, "data");
  dataViewStream.setUint32(40, audioBuffer.length * 2, true);
  const soundChannelPayload = audioBuffer.getChannelData(0);
  let memoryIndex = 44;
  for (let idx = 0; idx < soundChannelPayload.length; idx++) {
    let clampFloatSample = Math.max(-1, Math.min(1, soundChannelPayload[idx]));
    clampFloatSample =
      clampFloatSample < 0
        ? clampFloatSample * 0x8000
        : clampFloatSample * 0x7fff;
    dataViewStream.setInt16(memoryIndex, clampFloatSample, true);
    memoryIndex += 2;
  }
  const binaryPayloadBlob = new Blob([payloadBuffer], { type: "audio/wav" });
  return URL.createObjectURL(binaryPayloadBlob);
}

function writeAsciiCharactersIntoBufferView(
  dataViewRef,
  byteOffsetIdx,
  targetString,
) {
  for (let idx = 0; idx < targetString.length; idx++) {
    dataViewRef.setUint8(byteOffsetIdx + idx, targetString.charCodeAt(idx));
  }
}

function triggerMindMapDrawingCanvasModule(cardId) {
  const targetCard = dbPages.find((page) => page.id === cardId);
  if (!targetCard) return;
  queryHTMLElementById("mindmap-target-title").textContent =
    "PÁGINA: " + targetCard.term.toUpperCase();
  const rawInteractiveCanvas = queryHTMLElementById(
    "mindmap-interactive-canvas",
  );
  drawingCanvasContext = rawInteractiveCanvas.getContext("2d");
  const drawingBoxParent = rawInteractiveCanvas.parentElement;
  rawInteractiveCanvas.width = drawingBoxParent.clientWidth || 600;
  rawInteractiveCanvas.height = drawingBoxParent.clientHeight || 480;
  mindmapTextNodes = [];
  mindmapNodeConnectors = [];
  userDrawingStrokesStack = [];
  drawingCanvasContext.fillStyle = "#030107";
  drawingCanvasContext.fillRect(
    0,
    0,
    rawInteractiveCanvas.width,
    rawInteractiveCanvas.height,
  );
  queryHTMLElementById("mindmap-editor-modal").classList.remove("hidden");
  redrawCurrentCanvasGraphics();
}

function buildInteractiveCanvasHandlers() {
  const activeCanvas = queryHTMLElementById("mindmap-interactive-canvas");
  const brushSizeInput = queryHTMLElementById("mindmap-brush-range");
  const sizeIndicatorLabel = queryHTMLElementById("brush-size-indicator");
  const toolButtons = queryAllHTMLElements(".side-tool-btn");
  const paletteColorButtons = queryAllHTMLElements(".color-dot");
  activeCanvas.addEventListener("mousedown", triggerCanvasPressDown);
  activeCanvas.addEventListener("mousemove", triggerCanvasMouseMoveMove);
  activeCanvas.addEventListener("mouseup", endCanvasDrawingStroke);
  activeCanvas.addEventListener("mouseleave", endCanvasDrawingStroke);
  activeCanvas.addEventListener("touchstart", (evt) => {
    const rawTouchRef = evt.touches[0];
    const boundaries = activeCanvas.getBoundingClientRect();
    triggerCanvasPressDown({
      clientX: rawTouchRef.clientX,
      clientY: rawTouchRef.clientY,
      preventDefault: () => evt.preventDefault(),
    });
  });
  activeCanvas.addEventListener("touchmove", (evt) => {
    const rawTouchRef = evt.touches[0];
    const boundaries = activeCanvas.getBoundingClientRect();
    triggerCanvasMouseMoveMove({
      clientX: rawTouchRef.clientX,
      clientY: rawTouchRef.clientY,
      preventDefault: () => evt.preventDefault(),
    });
  });
  activeCanvas.addEventListener("touchend", endCanvasDrawingStroke);
  brushSizeInput.addEventListener("input", () => {
    userSelectedDrawingSize = parseInt(brushSizeInput.value, 10);
    sizeIndicatorLabel.textContent = userSelectedDrawingSize + " px";
  });
  toolButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      toolButtons.forEach((bi) => bi.classList.remove("active"));
      btn.classList.add("active");
      currentDrawingModeTool = btn.dataset.tool;
    });
  });
  paletteColorButtons.forEach((dot) => {
    dot.addEventListener("click", () => {
      paletteColorButtons.forEach((bi) => bi.classList.remove("active"));
      dot.classList.add("active");
      userSelectedDrawingColor = dot.dataset.color;
    });
  });
  queryHTMLElementById("mindmap-undo-btn").addEventListener("click", () => {
    if (userDrawingStrokesStack.length > 0) {
      userDrawingStrokesStack.pop();
      redrawCurrentCanvasGraphics();
    }
  });
  queryHTMLElementById("btn-reset-canvas").addEventListener("click", () => {
    userDrawingStrokesStack = [];
    mindmapTextNodes = [];
    mindmapNodeConnectors = [];
    redrawCurrentCanvasGraphics();
  });
  queryHTMLElementById("cancel-mindmap-btn").addEventListener("click", () => {
    queryHTMLElementById("mindmap-editor-modal").classList.add("hidden");
    queryHTMLElementById("add-class-content-modal").classList.remove("hidden");
  });
  queryHTMLElementById("save-mindmap-to-page-btn").addEventListener(
    "click",
    async () => {
      const dataUrlImageBlob = activeCanvas.toDataURL("image/png");
      const targetPageId = await addContentBlockToTargetPage(
        activePageAttachmentTargetId,
        "mindmap",
        dataUrlImageBlob,
      );
      queryHTMLElementById("mindmap-editor-modal").classList.add("hidden");

      // Auto navigate to the page
      const updatedCategorizedList = filterAndSortDatabaseRecords();
      const matchingCardIdx = updatedCategorizedList.findIndex(
        (item) => item.id === targetPageId,
      );
      if (matchingCardIdx !== -1) {
        currentActiveViewPageIdx = Math.floor(matchingCardIdx / 2) + 2;
      }
      renderDigitalBookState();
    },
  );
  queryHTMLElementById("tpl-concept-map").addEventListener("click", () => {
    injectConceptMapPredefinedTemplate();
  });
  queryHTMLElementById("tpl-flowchart").addEventListener("click", () => {
    injectFlowchartPredefinedTemplate();
  });
}

function triggerCanvasPressDown(evt) {
  const boundaries = queryHTMLElementById(
    "mindmap-interactive-canvas",
  ).getBoundingClientRect();
  const currentX = evt.clientX - boundaries.left;
  const currentY = evt.clientY - boundaries.top;
  if (
    currentDrawingModeTool === "brush" ||
    currentDrawingModeTool === "eraser"
  ) {
    isCurrentlyDrawingOnCanvas = true;
    lastRecordedCoordinates = { x: currentX, y: (yCoord = currentY) };
    userDrawingStrokesStack.push({
      tool: currentDrawingModeTool,
      color:
        currentDrawingModeTool === "eraser"
          ? "#030107"
          : userSelectedDrawingColor,
      size: userSelectedDrawingSize,
      points: [{ x: currentX, y: currentY }],
    });
  } else if (currentDrawingModeTool === "text") {
    const inputField = queryHTMLElementById("mindmap-direct-text-entry");
    inputField.value = "";
    inputField.style.left = currentX + "px";
    inputField.style.top = currentY + "px";
    inputField.classList.remove("hidden");
    inputField.focus();
    inputField.onkeydown = (eventKeyIdx) => {
      if (eventKeyIdx.key === "Enter") {
        const textVal = inputField.value.trim();
        if (textVal) {
          mindmapTextNodes.push({
            id: generateUniqueId(),
            x: currentX,
            y: currentY,
            text: textVal,
            w: Math.max(100, textVal.length * 8 + 20),
            h: 36,
          });
          redrawCurrentCanvasGraphics();
        }
        inputField.classList.add("hidden");
      }
    };
  } else if (currentDrawingModeTool === "connector") {
    const clickedNode = findTargetNodeUnderCoordinates(currentX, currentY);
    if (clickedNode) {
      isCurrentlyDrawingOnCanvas = true;
      lastRecordedCoordinates = { x: currentX, y: currentY };
      activeCanvasDragConnectingElement = {
        fromNode: clickedNode,
        tempX: currentX,
        tempY: currentY,
      };
    }
  }
}

let activeCanvasDragConnectingElement = null;

function triggerCanvasMouseMoveMove(evt) {
  if (!isCurrentlyDrawingOnCanvas) return;
  const boundaries = queryHTMLElementById(
    "mindmap-interactive-canvas",
  ).getBoundingClientRect();
  const currentX = evt.clientX - boundaries.left;
  const currentY = evt.clientY - boundaries.top;
  if (
    currentDrawingModeTool === "brush" ||
    currentDrawingModeTool === "eraser"
  ) {
    const currentActiveStroke =
      userDrawingStrokesStack[userDrawingStrokesStack.length - 1];
    if (currentActiveStroke) {
      currentActiveStroke.points.push({ x: currentX, y: currentY });
      drawCurrentStrokeSegment(
        lastRecordedCoordinates.x,
        lastRecordedCoordinates.y,
        currentX,
        currentY,
        currentActiveStroke.color,
        currentActiveStroke.size,
      );
    }
    lastRecordedCoordinates = { x: currentX, y: currentY };
  } else if (
    currentDrawingModeTool === "connector" &&
    activeCanvasDragConnectingElement
  ) {
    activeCanvasDragConnectingElement.tempX = currentX;
    activeCanvasDragConnectingElement.tempY = currentY;
    redrawCurrentCanvasGraphics();
    drawingCanvasContext.beginPath();
    drawingCanvasContext.strokeStyle = "rgba(255, 0, 127, 0.5)";
    drawingCanvasContext.lineWidth = 2;
    drawingCanvasContext.setLineDash([4, 4]);
    drawingCanvasContext.moveTo(
      activeCanvasDragConnectingElement.fromNode.x,
      activeCanvasDragConnectingElement.fromNode.y,
    );
    drawingCanvasContext.lineTo(currentX, currentY);
    drawingCanvasContext.stroke();
    drawingCanvasContext.setLineDash([]);
  }
}

function findTargetNodeUnderCoordinates(pX, pY) {
  return mindmapTextNodes.find((node) => {
    const hHalfW = node.w / 2;
    const hHalfH = node.h / 2;
    return (
      pX >= node.x - hHalfW &&
      pX <= node.x + hHalfW &&
      pY >= node.y - hHalfH &&
      pY <= node.y + hHalfH
    );
  });
}

function endCanvasDrawingStroke(evt) {
  if (!isCurrentlyDrawingOnCanvas) return;
  isCurrentlyDrawingOnCanvas = false;
  if (
    currentDrawingModeTool === "connector" &&
    activeCanvasDragConnectingElement
  ) {
    const boundaries = queryHTMLElementById(
      "mindmap-interactive-canvas",
    ).getBoundingClientRect();
    let currentX = evt.clientX - boundaries.left;
    let currentY = evt.clientY - boundaries.top;
    if (isNaN(currentX)) {
      currentX = activeCanvasDragConnectingElement.tempX;
      currentY = activeCanvasDragConnectingElement.tempY;
    }
    const destNode = findTargetNodeUnderCoordinates(currentX, currentY);
    if (
      destNode &&
      destNode.id !== activeCanvasDragConnectingElement.fromNode.id
    ) {
      mindmapNodeConnectors.push({
        sourceId: activeCanvasDragConnectingElement.fromNode.id,
        targetId: destNode.id,
      });
    }
    activeCanvasDragConnectingElement = null;
    redrawCurrentCanvasGraphics();
  }
}

function drawCurrentStrokeSegment(
  sourceX,
  sourceY,
  destX,
  destY,
  brushColor,
  brushSize,
) {
  drawingCanvasContext.beginPath();
  drawingCanvasContext.strokeStyle = brushColor;
  drawingCanvasContext.lineWidth = brushSize;
  drawingCanvasContext.lineCap = "round";
  drawingCanvasContext.lineJoin = "round";
  drawingCanvasContext.moveTo(sourceX, sourceY);
  drawingCanvasContext.lineTo(destX, destY);
  drawingCanvasContext.stroke();
  drawingCanvasContext.closePath();
}

function redrawCurrentCanvasGraphics() {
  const activeCanvas = queryHTMLElementById("mindmap-interactive-canvas");
  drawingCanvasContext.fillStyle = "#030107";
  drawingCanvasContext.fillRect(0, 0, activeCanvas.width, activeCanvas.height);
  userDrawingStrokesStack.forEach((stroke) => {
    if (stroke.points.length < 1) return;
    drawingCanvasContext.beginPath();
    drawingCanvasContext.strokeStyle = stroke.color;
    drawingCanvasContext.lineWidth = stroke.size;
    drawingCanvasContext.lineCap = "round";
    drawingCanvasContext.lineJoin = "round";
    drawingCanvasContext.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let pointIdx = 1; pointIdx < stroke.points.length; pointIdx++) {
      drawingCanvasContext.lineTo(
        stroke.points[pointIdx].x,
        stroke.points[pointIdx].y,
      );
    }
    drawingCanvasContext.stroke();
    drawingCanvasContext.closePath();
  });
  mindmapNodeConnectors.forEach((conn) => {
    const srcNode = mindmapTextNodes.find((n) => n.id === conn.sourceId);
    const dstNode = mindmapTextNodes.find((n) => n.id === conn.targetId);
    if (srcNode && dstNode) {
      drawingCanvasContext.beginPath();
      drawingCanvasContext.strokeStyle = "#826e99";
      drawingCanvasContext.lineWidth = 2;
      drawingCanvasContext.moveTo(srcNode.x, srcNode.y);
      drawingCanvasContext.lineTo(dstNode.x, dstNode.y);
      drawingCanvasContext.stroke();
      drawingCanvasContext.closePath();
      const pointerAngle = Math.atan2(
        dstNode.y - srcNode.y,
        dstNode.x - srcNode.x,
      );
      const arrowPointDistance = dstNode.w / 2 + 5;
      const arrowTipCoordinatesX =
        dstNode.x - Math.cos(pointerAngle) * arrowPointDistance;
      const arrowTipCoordinatesY =
        dstNode.y - Math.sin(pointerAngle) * arrowPointDistance;
      drawingCanvasContext.beginPath();
      drawingCanvasContext.fillStyle = "#00bcff";
      drawingCanvasContext.moveTo(arrowTipCoordinatesX, arrowTipCoordinatesY);
      drawingCanvasContext.lineTo(
        arrowTipCoordinatesX - 10 * Math.cos(pointerAngle - Math.PI / 6),
        arrowTipCoordinatesY - 10 * Math.sin(pointerAngle - Math.PI / 6),
      );
      drawingCanvasContext.lineTo(
        arrowTipCoordinatesX - 10 * Math.cos(pointerAngle + Math.PI / 6),
        arrowTipCoordinatesY - 10 * Math.sin(pointerAngle + Math.PI / 6),
      );
      drawingCanvasContext.fill();
    }
  });
  mindmapTextNodes.forEach((node) => {
    const leftAnchorX = node.x - node.w / 2;
    const topAnchorY = node.y - node.h / 2;
    drawingCanvasContext.fillStyle = "#0c0819";
    drawingCanvasContext.strokeStyle = "#00bcff";
    drawingCanvasContext.lineWidth = 1.5;
    drawingCanvasContext.fillRect(leftAnchorX, topAnchorY, node.w, node.h);
    drawingCanvasContext.strokeRect(leftAnchorX, topAnchorY, node.w, node.h);
    drawingCanvasContext.fillStyle = "#ffffff";
    drawingCanvasContext.font = "bold 13px 'Space Grotesk', sans-serif";
    drawingCanvasContext.textAlign = "center";
    drawingCanvasContext.textBaseline = "middle";
    drawingCanvasContext.fillText(node.text, node.x, node.y + 1);
  });
}

function injectConceptMapPredefinedTemplate() {
  const activeCanvas = queryHTMLElementById("mindmap-interactive-canvas");
  const cX = activeCanvas.width / 2;
  const cY = activeCanvas.height / 2;
  mindmapTextNodes = [];
  mindmapNodeConnectors = [];
  const rootNodeId = generateUniqueId();
  const subNodeId1 = generateUniqueId();
  const subNodeId2 = generateUniqueId();
  const subNodeId3 = generateUniqueId();
  mindmapTextNodes.push({
    id: rootNodeId,
    x: cX,
    y: cY,
    text: "MAIN CONCEPT",
    w: 160,
    h: 40,
  });
  mindmapTextNodes.push({
    id: subNodeId1,
    x: cX - 180,
    y: cY - 100,
    text: "DEFINITION",
    w: 120,
    h: 36,
  });
  mindmapTextNodes.push({
    id: subNodeId2,
    x: cX + 180,
    y: cY - 100,
    text: "USE CASES",
    w: 120,
    h: 36,
  });
  mindmapTextNodes.push({
    id: subNodeId3,
    x: cX,
    y: cY + 140,
    text: "EXAMPLES",
    w: 120,
    h: 36,
  });
  mindmapNodeConnectors.push({ sourceId: rootNodeId, targetId: subNodeId1 });
  mindmapNodeConnectors.push({ sourceId: rootNodeId, targetId: subNodeId2 });
  mindmapNodeConnectors.push({ sourceId: rootNodeId, targetId: subNodeId3 });
  redrawCurrentCanvasGraphics();
}

function injectFlowchartPredefinedTemplate() {
  const activeCanvas = queryHTMLElementById("mindmap-interactive-canvas");
  const cX = activeCanvas.width / 2;
  const cY = activeCanvas.height / 2;
  mindmapTextNodes = [];
  mindmapNodeConnectors = [];
  const step1 = generateUniqueId();
  const step2 = generateUniqueId();
  const step3 = generateUniqueId();
  const step4 = generateUniqueId();
  mindmapTextNodes.push({
    id: step1,
    x: cX,
    y: cY - 160,
    text: "START / INITIAL INPUT",
    w: 140,
    h: 36,
  });
  mindmapTextNodes.push({
    id: step2,
    x: cX,
    y: cY - 60,
    text: "CORE PROCESS",
    w: 140,
    h: 36,
  });
  mindmapTextNodes.push({
    id: step3,
    x: cX,
    y: cY + 40,
    text: "SUCCESS DECISION?",
    w: 140,
    h: 36,
  });
  mindmapTextNodes.push({
    id: step4,
    x: cX,
    y: cY + 140,
    text: "FINAL STEP",
    w: 140,
    h: 36,
  });
  mindmapNodeConnectors.push({ sourceId: step1, targetId: step2 });
  mindmapNodeConnectors.push({ sourceId: step2, targetId: step3 });
  mindmapNodeConnectors.push({ sourceId: step3, targetId: step4 });
  redrawCurrentCanvasGraphics();
}

function refreshStatsCounters() {
  queryHTMLElementById("stat-total-pages").textContent = dbPages.length;
  queryHTMLElementById("stat-total-entries").textContent = dbPages.length;
  let drawingsCounter = 0;
  dbPages.forEach((page) => {
    if (page.contents) {
      page.contents.forEach((block) => {
        if (block.type === "mindmap") {
          drawingsCounter++;
        }
      });
    }
  });
  queryHTMLElementById("stat-canvas-drawings").textContent = drawingsCounter;
}

function calculateAndShowStatisticsGraphAndCounters() {
  queryHTMLElementById("stat-card-total").textContent = dbPages.length;
  let counterTxt = 0;
  let counterMap = 0;
  let counterImg = 0;
  let counterAud = 0;
  let counterPdf = 0;
  dbPages.forEach((page) => {
    if (page.contents) {
      page.contents.forEach((block) => {
        if (block.type === "paragraph") counterTxt++;
        else if (block.type === "mindmap") counterMap++;
        else if (block.type === "image") counterImg++;
        else if (block.type === "audio") counterAud++;
        else if (block.type === "pdf") counterPdf++;
      });
    }
  });
  queryHTMLElementById("stat-count-txt").textContent = counterTxt;
  queryHTMLElementById("stat-count-map").textContent = counterMap;
  queryHTMLElementById("stat-count-img").textContent = counterImg;
  queryHTMLElementById("stat-count-aud").textContent = counterAud;
  queryHTMLElementById("stat-count-pdf").textContent = counterPdf;
  const metricsBarsDistributionRow = queryHTMLElementById(
    "letter-bars-distribution",
  );
  metricsBarsDistributionRow.innerHTML = "";
  const rangeAbc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");
  const metricsTotalsMap = {};
  rangeAbc.forEach((letra) => (metricsTotalsMap[letra] = 0));
  dbPages.forEach((page) => {
    const lUpper = extractFirstAlphabeticalChar(page.term);
    metricsTotalsMap[lUpper] = (metricsTotalsMap[lUpper] || 0) + 1;
  });
  const maxLetterValue = Math.max(1, ...Object.values(metricsTotalsMap));
  rangeAbc.forEach((letra) => {
    const valueCountResult = metricsTotalsMap[letra];
    const percentageFill = Math.floor(
      (valueCountResult / maxLetterValue) * 100,
    );
    const colDiv = document.createElement("div");
    colDiv.className = "bar-column";
    colDiv.innerHTML = `
      <div class="bar-fill" style="height: ${percentageFill}%;" title="${letra}: ${valueCountResult}"></div>
      <span class="bar-lbl">${letra}</span>
    `;
    metricsBarsDistributionRow.appendChild(colDiv);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initializeDictionaryApp();
});

async function probarStorage() {
  console.log("Intentando guardar...");
  
  const { data, error } = await _supabase
    .from('date')
    .insert([ { texto: "Hola desde mi web", autor: "Usuario" } ]);

  if (error) {
    console.error("Error al guardar:", error);
    alert("Hubo un error al guardar. Revisa la consola.");
  } else {
    console.log("¡Éxito! Datos guardados:", data);
    alert("¡Datos guardados correctamente en la nube!");
  }
}

probarStorage();
