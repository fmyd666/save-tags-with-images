const DB_NAME = "comfyui-local-gallery";
const DB_VERSION = 1;
const STORE_NAME = "images";
const INDEX_FILE = "index.json";
const PARSER_VERSION = 3;

const state = {
  db: null,
  entries: [],
  query: "",
  activeTag: "",
  activeSection: "",
  customCategories: loadCustomCategories(),
  view: localStorage.getItem("galleryView") || "comfort",
  directoryHandle: null,
  isDirectorySyncing: false,
  isLibraryMutating: false,
  objectUrls: new Map(),
  isDraggingCard: false,
  blockCardDrag: false,
  viewer: {
    entryId: "",
    scale: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
  },
};

const elements = {
  fileInput: document.querySelector("#fileInput"),
  dropZone: document.querySelector("#dropZone"),
  pickFolderButton: document.querySelector("#pickFolderButton"),
  exportButton: document.querySelector("#exportButton"),
  clearButton: document.querySelector("#clearButton"),
  searchInput: document.querySelector("#searchInput"),
  newCategoryButton: document.querySelector("#newCategoryButton"),
  sectionList: document.querySelector("#sectionList"),
  tagCloud: document.querySelector("#tagCloud"),
  gallery: document.querySelector("#gallery"),
  emptyState: document.querySelector("#emptyState"),
  totalCount: document.querySelector("#totalCount"),
  visibleCount: document.querySelector("#visibleCount"),
  tagCount: document.querySelector("#tagCount"),
  storageStatus: document.querySelector("#storageStatus"),
  toast: document.querySelector("#toast"),
  detailDialog: document.querySelector("#detailDialog"),
  dialogContent: document.querySelector("#dialogContent"),
  closeDialogButton: document.querySelector("#closeDialogButton"),
  imageViewerDialog: document.querySelector("#imageViewerDialog"),
  imageViewerContent: document.querySelector("#imageViewerContent"),
  closeImageViewerButton: document.querySelector("#closeImageViewerButton"),
  downloadImageViewerButton: document.querySelector("#downloadImageViewerButton"),
  segments: [...document.querySelectorAll(".segment")],
};

init();

function loadCustomCategories() {
  try {
    const saved = localStorage.getItem("customCategories") || localStorage.getItem("customFolders") || "[]";
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map(normalizeCategoryLabel).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function saveCustomCategories() {
  state.customCategories = [...new Set(state.customCategories.map(normalizeCategoryLabel).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  localStorage.setItem("customCategories", JSON.stringify(state.customCategories));
}

function blockLibraryMutation(action) {
  if (!state.isDirectorySyncing) return false;
  showToast(`正在同步本地目录，请稍后再${action}`);
  return true;
}

function beginLibraryMutation(action) {
  if (blockLibraryMutation(action)) return false;
  if (state.isLibraryMutating) {
    showToast("正在处理本地库，请稍后再试");
    return false;
  }
  state.isLibraryMutating = true;
  return true;
}

function endLibraryMutation() {
  state.isLibraryMutating = false;
}

function showDirectorySyncFailure(context = "目录同步") {
  showToast(`${context}失败，IndexedDB 数据已保留。目录可能已有部分文件，请重试同步。`);
}

async function init() {
  state.db = await openDatabase();
  await loadEntries();
  bindEvents();
  applyViewMode();
  render();
  showToast("本地库已就绪");
}

function bindEvents() {
  elements.fileInput.addEventListener("change", async (event) => {
    await importFiles([...event.target.files]);
    elements.fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("is-dragging");
    });
  });

  elements.dropZone.addEventListener("drop", async (event) => {
    await importFiles([...event.dataTransfer.files]);
  });

  elements.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    state.activeTag = "";
    render();
  });

  elements.newCategoryButton.addEventListener("click", createCategoryFromPrompt);

  elements.pickFolderButton.addEventListener("click", pickDirectory);
  elements.exportButton.addEventListener("click", exportIndex);
  elements.clearButton.addEventListener("click", clearLibrary);
  elements.closeDialogButton.addEventListener("click", () => elements.detailDialog.close());
  elements.closeImageViewerButton.addEventListener("click", closeImageViewer);
  elements.downloadImageViewerButton.addEventListener("click", () => downloadOriginalImage(state.viewer.entryId));
  elements.imageViewerDialog.addEventListener("close", clearImageViewer);
  elements.dialogContent.addEventListener("click", handleDialogAction);
  elements.dialogContent.addEventListener("keydown", handleDialogKeydown);
  elements.imageViewerContent.addEventListener("wheel", handleImageViewerWheel, { passive: false });
  elements.imageViewerContent.addEventListener("pointerdown", handleImageViewerPointerDown);
  elements.imageViewerContent.addEventListener("pointermove", handleImageViewerPointerMove);
  elements.imageViewerContent.addEventListener("pointerup", handleImageViewerPointerEnd);
  elements.imageViewerContent.addEventListener("pointercancel", handleImageViewerPointerEnd);
  elements.imageViewerContent.addEventListener("auxclick", (event) => {
    if (event.button === 1) {
      event.preventDefault();
    }
  });
  elements.imageViewerContent.addEventListener("dblclick", resetImageViewerTransform);

  elements.segments.forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      localStorage.setItem("galleryView", state.view);
      applyViewMode();
    });
  });

  elements.gallery.addEventListener("click", async (event) => {
    if (state.isDraggingCard) return;

    const downloadButton = event.target.closest("[data-download-image-id]");
    if (downloadButton) {
      event.preventDefault();
      event.stopPropagation();
      downloadOriginalImage(downloadButton.dataset.downloadImageId);
      return;
    }

    const imageButton = event.target.closest("[data-open-id]");
    if (imageButton) {
      if (isCardTextTarget(event.target)) {
        openDetail(imageButton.dataset.openId);
      } else {
        openImageViewer(imageButton.dataset.openId);
      }
    }
  });

  elements.gallery.addEventListener("pointerdown", handleGalleryPointerDown);
  elements.gallery.addEventListener("pointerup", clearBlockedCardDrag);
  elements.gallery.addEventListener("pointercancel", clearBlockedCardDrag);
  elements.gallery.addEventListener("dragstart", handleCardDragStart);
  elements.gallery.addEventListener("dragend", () => {
    window.setTimeout(() => {
      state.isDraggingCard = false;
    }, 0);
  });
}

async function createCategoryFromPrompt() {
  if (!beginLibraryMutation("新建分类")) return;

  try {
    const rawName = window.prompt("新建分类标签：");
    if (rawName === null) return;

    const categoryName = normalizeCategoryLabel(rawName);
    if (!categoryName) {
      showToast("分类标签不能为空");
      return;
    }

    let categoryAdded = false;
    if (!state.customCategories.some((category) => category.toLowerCase() === categoryName.toLowerCase())) {
      state.customCategories.push(categoryName);
      saveCustomCategories();
      categoryAdded = true;
    }

    let directoryFailed = false;
    if (state.directoryHandle && categoryAdded) {
      try {
        await writeDirectoryIndex();
      } catch (error) {
        directoryFailed = true;
        console.error(error);
        showToast("目录索引同步失败，分类已保存在本机。请确认目录可写后重新选择同一目录重试同步。");
      }
    }

    state.activeSection = categoryName;
    render();
    if (!directoryFailed) {
      showToast(`已新建分类：${categoryName}`);
    }
  } finally {
    endLibraryMutation();
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbTransaction(mode = "readonly") {
  return state.db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadEntries() {
  const records = await requestToPromise(dbTransaction().getAll());
  const migrated = [];

  for (const record of records) {
    const nextRecord = await migrateEntry(record);
    migrated.push(nextRecord);
    if (nextRecord !== record) {
      await saveEntry(nextRecord);
    }
  }

  state.entries = migrated.sort((a, b) => b.createdAt - a.createdAt);
}

async function saveEntry(entry) {
  await requestToPromise(dbTransaction("readwrite").put(entry));
}

async function removeEntry(id) {
  await requestToPromise(dbTransaction("readwrite").delete(id));
}

async function clearEntries() {
  await requestToPromise(dbTransaction("readwrite").clear());
}

async function importFiles(files) {
  if (!beginLibraryMutation("导入图片")) return;

  const imageFiles = files.filter(isSupportedImageFile);
  if (!imageFiles.length) {
    showToast("没有找到可导入的图片");
    endLibraryMutation();
    return;
  }

  try {
    let imported = 0;
    let updated = 0;
    let directoryFailed = false;
    const entriesById = new Map(state.entries.map((entry) => [entry.id, entry]));

    for (const file of imageFiles) {
      try {
        const buffer = await file.arrayBuffer();
        const metadata = await readImageMetadata(file, buffer);
        const imageInfo = await readImageSize(file);
        const tags = buildTags(metadata);
        const savedTags = pickInitialSavedTags(tags);
        const id = await hashFile(buffer, file.name, file.lastModified);
        const existingEntry = entriesById.get(id);
        const preserveEditedTags = hasCustomSavedTags(existingEntry);
        const importedAt = new Date().toISOString();
        const sourceModifiedAt = file.lastModified ? new Date(file.lastModified).toISOString() : importedAt;
        const displayName = existingEntry ? getStoredDisplayName(existingEntry) : formatEntryTime(sourceModifiedAt);
        const entry = {
          id,
          parserVersion: PARSER_VERSION,
          name: file.name,
          displayName,
          displayNameEdited: Boolean(existingEntry?.displayNameEdited && displayName),
          type: file.type || guessMimeType(file.name),
          size: file.size,
          width: imageInfo.width,
          height: imageInfo.height,
          createdAt: existingEntry?.createdAt || Date.now(),
          importedAt: existingEntry?.importedAt || importedAt,
          sourceModifiedAt,
          note: existingEntry?.note || "",
          section: "",
          categories: existingEntry ? getEntryCategories(existingEntry) : [],
          tags,
          savedTags: preserveEditedTags ? existingEntry.savedTags : savedTags,
          savedTagsEdited: preserveEditedTags,
          positivePrompt: metadata.positivePrompt,
          negativePrompt: metadata.negativePrompt,
          modelTags: metadata.modelTags,
          samplerTags: metadata.samplerTags,
          rawMetadata: metadata.raw,
          imageBuffer: buffer,
        };

        if (existingEntry) {
          clearObjectUrl(id);
          updated += 1;
        } else {
          imported += 1;
        }
        await saveEntry(entry);
        try {
          await syncEntryToDirectory(entry);
          if (existingEntry && getDirectoryImageFileName(existingEntry) !== getDirectoryImageFileName(entry)) {
            await deleteEntryImageFromDirectory(existingEntry);
          }
        } catch (error) {
          directoryFailed = true;
          console.error(error);
        }
        entriesById.set(id, entry);
      } catch (error) {
        console.error(error);
        showToast(`${file.name} 导入失败：${error.message || "无法读取"}`);
      }
    }

    await loadEntries();
    render();
    if (state.directoryHandle && !directoryFailed) {
      try {
        await writeDirectoryIndex();
      } catch (error) {
        directoryFailed = true;
        console.error(error);
      }
    }
    if (directoryFailed) {
      showDirectorySyncFailure("目录同步");
    } else {
      showToast(`已导入 ${imported} 张图片${updated ? `，更新 ${updated} 张` : ""}`);
    }
  } finally {
    endLibraryMutation();
  }
}

async function migrateEntry(entry) {
  const note = typeof entry.note === "string" ? entry.note : "";
  const section = normalizeSection(entry.section || "");
  const categories = getEntryCategories({ ...entry, section });
  const sourceModifiedAt = entry.sourceModifiedAt || "";
  const displayName = getStoredDisplayName({ ...entry, sourceModifiedAt });
  const displayNameEdited = Boolean(entry.displayNameEdited && displayName);
  const normalizedEntry = {
    ...entry,
    note,
    section,
    categories,
    sourceModifiedAt,
    displayName,
    displayNameEdited,
  };
  const needsFieldUpdate =
    entry.note !== note ||
    entry.section !== section ||
    JSON.stringify(entry.categories || []) !== JSON.stringify(categories) ||
    entry.displayName !== displayName ||
    entry.displayNameEdited !== displayNameEdited ||
    entry.sourceModifiedAt !== sourceModifiedAt;

  if (entry.parserVersion === PARSER_VERSION || !entry.imageBuffer) {
    if (!needsFieldUpdate && entry.parserVersion === PARSER_VERSION) {
      return entry;
    }

    return {
      ...normalizedEntry,
      parserVersion: PARSER_VERSION,
    };
  }

  try {
    const metadata = await readImageMetadata({ name: normalizedEntry.name, type: normalizedEntry.type }, normalizedEntry.imageBuffer);
    const tags = buildTags(metadata);
    const oldSavedTags = Array.isArray(normalizedEntry.savedTags) ? normalizedEntry.savedTags : [];
    const shouldRefreshSavedTags =
      !normalizedEntry.savedTagsEdited ||
      oldSavedTags.length === 0 ||
      !hasCustomSavedTags(normalizedEntry) ||
      oldSavedTags.some((tag) => isMetadataLikeText(tag.label) || isLikelyNegativeOnlyTag(tag.label));

    return {
      ...normalizedEntry,
      parserVersion: PARSER_VERSION,
      tags,
      savedTags: shouldRefreshSavedTags ? pickInitialSavedTags(tags) : oldSavedTags,
      positivePrompt: metadata.positivePrompt,
      negativePrompt: metadata.negativePrompt,
      modelTags: metadata.modelTags,
      samplerTags: metadata.samplerTags,
      rawMetadata: metadata.raw,
    };
  } catch (error) {
    console.warn("迁移旧解析记录失败", entry.name, error);
    return {
      ...normalizedEntry,
      parserVersion: PARSER_VERSION,
    };
  }
}

async function readImageMetadata(file, buffer) {
  const type = file.type || guessMimeType(file.name);
  if (type === "image/png" || file.name.toLowerCase().endsWith(".png")) {
    return normalizeMetadata(await readPngTextChunks(buffer));
  }

  const loose = readLooseMetadataText(buffer);
  return normalizeMetadata(loose);
}

async function readPngTextChunks(buffer) {
  const bytes = new Uint8Array(buffer);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) {
    return {};
  }

  const view = new DataView(buffer);
  const decoder = new TextDecoder("utf-8");
  const latinDecoder = new TextDecoder("latin1");
  const chunks = {};
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = decoder.decode(bytes.slice(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) break;

    const data = bytes.slice(dataStart, dataEnd);
    if (type === "tEXt") {
      const separator = data.indexOf(0);
      if (separator > -1) {
        const key = latinDecoder.decode(data.slice(0, separator));
        chunks[key] = decoder.decode(data.slice(separator + 1));
      }
    }

    if (type === "iTXt") {
      const parsed = parseITxtChunk(data, decoder, latinDecoder);
      if (parsed) {
        chunks[parsed.key] = parsed.value;
      }
    }

    if (type === "zTXt") {
      const parsed = await parseZTxtChunk(data, latinDecoder);
      if (parsed) {
        chunks[parsed.key] = parsed.value;
      }
    }

    offset = dataEnd + 4;
    if (type === "IEND") break;
  }

  return chunks;
}

function parseITxtChunk(data, decoder, latinDecoder) {
  const firstNull = data.indexOf(0);
  if (firstNull === -1 || firstNull + 5 >= data.length) return null;

  const key = latinDecoder.decode(data.slice(0, firstNull));
  const compressionFlag = data[firstNull + 1];
  let cursor = firstNull + 3;

  const languageEnd = data.indexOf(0, cursor);
  if (languageEnd === -1) return null;
  cursor = languageEnd + 1;

  const translatedEnd = data.indexOf(0, cursor);
  if (translatedEnd === -1) return null;
  cursor = translatedEnd + 1;

  if (compressionFlag === 1) {
    return null;
  }

  return {
    key,
    value: decoder.decode(data.slice(cursor)),
  };
}

async function parseZTxtChunk(data, latinDecoder) {
  const separator = data.indexOf(0);
  if (separator === -1 || !("DecompressionStream" in window)) return null;

  const key = latinDecoder.decode(data.slice(0, separator));
  const compressed = data.slice(separator + 2);
  try {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"));
    const text = await new Response(stream).text();
    return { key, value: text };
  } catch {
    return null;
  }
}

function readLooseMetadataText(buffer) {
  const bytes = new Uint8Array(buffer);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const result = {};
  const keys = ["prompt", "workflow", "parameters", "Comment", "UserComment", "Description"];

  for (const key of keys) {
    const found = extractJsonNearKey(text, key) || extractTextNearKey(text, key);
    if (found) {
      result[key] = found;
    }
  }

  return result;
}

function extractJsonNearKey(text, key) {
  const keyPosition = text.indexOf(key);
  if (keyPosition === -1) return "";

  const objectStart = text.indexOf("{", keyPosition);
  const arrayStart = text.indexOf("[", keyPosition);
  const starts = [objectStart, arrayStart].filter((position) => position > -1);
  if (!starts.length) return "";

  const start = Math.min(...starts);
  const opening = text[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < Math.min(text.length, start + 2_000_000); index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === opening) depth += 1;
    if (char === closing) depth -= 1;
    if (depth === 0) {
      return text.slice(start, index + 1);
    }
  }

  return "";
}

function extractTextNearKey(text, key) {
  const position = text.indexOf(key);
  if (position === -1) return "";
  return text.slice(position + key.length, position + key.length + 4000).replace(/\0/g, " ").trim();
}

function normalizeMetadata(raw) {
  const promptJson = parseMaybeJson(raw.prompt);
  const workflowJson = parseMaybeJson(raw.workflow);
  const parameters = raw.parameters || raw.Comment || raw.UserComment || raw.Description || "";
  const promptNodes = collectPromptNodes(promptJson);
  const nodes = promptNodes.length ? promptNodes : collectWorkflowNodes(workflowJson);
  const linkedRoles = inferLinkedPromptRoles(nodes, promptNodes.length ? null : workflowJson);
  const shouldOnlyUseLinkedPrompts = linkedRoles.size > 0;
  const positiveParts = [];
  const negativeParts = [];
  const modelTags = new Set();
  const samplerTags = new Set();

  for (const node of nodes) {
    const title = getNodeTitle(node).toLowerCase();
    const fields = getNodeFields(node);
    const promptValues = extractPromptFields(node, fields);
    const nodeClass = String(node.class_type || node.type || "").toLowerCase();
    const linkedRole = getLinkedPromptRole(node, linkedRoles);

    if (nodeClass.includes("checkpoint") || nodeClass.includes("lora") || nodeClass.includes("unet") || nodeClass.includes("vae")) {
      collectModelFields(fields, modelTags);
    }

    if (nodeClass.includes("ksampler") || title.includes("sampler")) {
      collectSamplerFields(fields, samplerTags);
    }

    for (const item of promptValues) {
      if (shouldOnlyUseLinkedPrompts && !linkedRole) {
        continue;
      }

      const role = linkedRole && linkedRole !== "mixed" ? linkedRole : item.role;
      if (role === "negative" || looksNegative(title, item.value)) {
        negativeParts.push(item.value);
      } else if (role === "positive" || role === "unknown") {
        positiveParts.push(item.value);
      } else {
        positiveParts.push(item.value);
      }
    }
  }

  const hasNodePrompts = positiveParts.length > 0 || negativeParts.length > 0;
  if (!hasNodePrompts) {
    const explicitPositive = extractExplicitRawPrompt(raw, ["positive", "Positive prompt", "Positive Prompt"]);
    const explicitNegative = extractExplicitRawPrompt(raw, ["negative", "Negative prompt", "Negative Prompt"]);
    if (explicitPositive) positiveParts.push(explicitPositive);
    if (explicitNegative) negativeParts.push(explicitNegative);
  }

  const hasStructuredPrompts = positiveParts.length > 0 || negativeParts.length > 0;
  if (!hasStructuredPrompts) {
    const parsedParameters = parseA1111Parameters(parameters);
    positiveParts.push(...parsedParameters.positive);
    negativeParts.push(...parsedParameters.negative);
  }

  return {
    raw,
    promptJson,
    workflowJson,
    positivePrompt: uniqueText(positiveParts).join("\n\n"),
    negativePrompt: uniqueText(negativeParts).join("\n\n"),
    modelTags: [...modelTags],
    samplerTags: [...samplerTags],
  };
}

function extractExplicitRawPrompt(raw, keys) {
  for (const key of keys) {
    const value = raw?.[key];
    if (typeof value === "string" && value.trim() && !isMetadataLikeText(value)) {
      return stripPromptPrefix(value.trim());
    }
  }
  return "";
}

function extractPromptFields(node, fields) {
  if (!isPromptNode(node, fields)) {
    return [];
  }

  const candidates = [];
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== "string") continue;
    if (!isPromptTextKey(key, node)) continue;

    const cleaned = stripPromptPrefix(value.trim());
    if (!cleaned || isMetadataLikeText(cleaned)) continue;

    candidates.push({
      value: cleaned,
      role: inferPromptRole(node, key, cleaned),
    });
  }

  return candidates;
}

function isPromptNode(node, fields) {
  const identity = `${node.class_type || ""} ${node.type || ""} ${getNodeTitle(node)}`.toLowerCase();
  const fieldKeys = Object.keys(fields).join(" ").toLowerCase();

  if (isUtilityNodeIdentity(identity)) {
    return false;
  }

  return (
    identity.includes("cliptextencode") ||
    identity.includes("textencode") ||
    identity.includes("text encode") ||
    identity.includes("prompt") ||
    identity.includes("wildcard") ||
    fieldKeys.split(/\s+/).some((key) => ["text", "positive", "negative", "prompt"].includes(key))
  );
}

function isUtilityNodeIdentity(identity) {
  const utilityTerms = [
    "lora",
    "checkpoint",
    "loader",
    "sampler",
    "scheduler",
    "vae",
    "controlnet",
    "upscale",
    "saveimage",
    "metadata",
    "stack",
    "selector",
  ];

  return utilityTerms.some((term) => identity.includes(term)) && !identity.includes("textencode") && !identity.includes("prompt");
}

function isPromptTextKey(key, node) {
  const normalizedKey = key.toLowerCase();
  const identity = `${node.class_type || ""} ${node.type || ""} ${getNodeTitle(node)}`.toLowerCase();

  if (
    normalizedKey.includes("lora") ||
    normalizedKey.includes("model") ||
    normalizedKey.includes("ckpt") ||
    normalizedKey.includes("vae") ||
    normalizedKey.includes("stack") ||
    normalizedKey.includes("config") ||
    normalizedKey.includes("json") ||
    normalizedKey.includes("file") ||
    normalizedKey.includes("path") ||
    normalizedKey.includes("name")
  ) {
    return false;
  }

  if (normalizedKey === "text" || normalizedKey === "prompt" || normalizedKey === "positive" || normalizedKey === "negative") {
    return true;
  }

  if (normalizedKey.includes("positive") || normalizedKey.includes("negative") || normalizedKey.includes("prompt")) {
    return true;
  }

  return normalizedKey.startsWith("text_widget_") && (identity.includes("prompt") || identity.includes("textencode") || identity.includes("text encode"));
}

function inferPromptRole(node, key, value) {
  const identity = `${node.class_type || ""} ${node.type || ""} ${getNodeTitle(node)} ${key}`.toLowerCase();
  const lowerValue = value.toLowerCase();

  if (identity.includes("negative") || lowerValue.startsWith("negative prompt:")) {
    return "negative";
  }

  if (identity.includes("positive") || lowerValue.startsWith("positive prompt:")) {
    return "positive";
  }

  return "unknown";
}

function stripPromptPrefix(value) {
  return value
    .replace(/^positive prompt:\s*/i, "")
    .replace(/^negative prompt:\s*/i, "")
    .trim();
}

function isMetadataLikeText(value) {
  const trimmed = value.trim();
  if (!trimmed) return false;

  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") return true;
    } catch {
      if ((trimmed.match(/"[^"]+"\s*:/g) || []).length >= 3) return true;
    }
  }

  const lower = trimmed.toLowerCase();
  const jsonKeyCount = (trimmed.match(/"[^"]+"\s*:/g) || []).length;
  return (
    jsonKeyCount >= 4 ||
    (lower.includes(".safetensors") && (lower.includes('"name"') || lower.includes('"weight"') || lower.includes('"lora"'))) ||
    lower.includes("trigger_weight") ||
    lower.includes("text_encoder_weight") ||
    lower.includes("loraworks") ||
    lower.includes("display_name")
  );
}

function collectNodes(promptJson, workflowJson) {
  const promptNodes = collectPromptNodes(promptJson);
  return promptNodes.length ? promptNodes : collectWorkflowNodes(workflowJson);
}

function collectPromptNodes(promptJson) {
  const nodes = [];
  const pushNode = (node, fallbackId = "") => {
    if (!node || typeof node !== "object") return;
    nodes.push({
      ...node,
      id: node.id ?? node._id ?? node.node_id ?? node.key ?? fallbackId,
    });
  };

  if (Array.isArray(promptJson)) {
    promptJson.forEach((node, index) => pushNode(node, index));
    return nodes;
  }

  if (promptJson && typeof promptJson === "object") {
    if (Array.isArray(promptJson.nodes)) {
      promptJson.nodes.forEach((node) => pushNode(node));
    }
    for (const [key, value] of Object.entries(promptJson)) {
      if (key !== "nodes" && value && typeof value === "object" && !Array.isArray(value)) {
        pushNode(value, key);
      }
    }
  }

  return nodes;
}

function collectWorkflowNodes(workflowJson) {
  const nodes = [];
  const pushNode = (node, fallbackId = "") => {
    if (!node || typeof node !== "object") return;
    nodes.push({
      ...node,
      id: node.id ?? node._id ?? node.node_id ?? node.key ?? fallbackId,
    });
  };

  if (Array.isArray(workflowJson)) {
    workflowJson.forEach((node, index) => pushNode(node, index));
    return nodes;
  }

  if (workflowJson && typeof workflowJson === "object") {
    if (Array.isArray(workflowJson.nodes)) {
      workflowJson.nodes.forEach((node) => pushNode(node));
    }
  }

  return nodes;
}

function inferLinkedPromptRoles(nodes, workflowJson = null) {
  const roles = new Map();
  const nodesById = new Map();
  const workflowLinkOrigins = buildWorkflowLinkOrigins(workflowJson);

  for (const node of nodes) {
    const key = normalizeNodeId(node.id ?? node._id ?? node.node_id ?? node.key ?? node.index);
    if (key) {
      nodesById.set(key, node);
    }
  }

  for (const node of nodes) {
    const identity = `${node.class_type || ""} ${node.type || ""} ${getNodeTitle(node)}`.toLowerCase();
    if (!identity.includes("ksampler") && !identity.includes("sampler")) continue;

    for (const role of ["positive", "negative"]) {
      for (const linkedId of getRoleInputNodeIds(node, role, workflowLinkOrigins)) {
        markLinkedPromptRole(linkedId, role, nodesById, workflowLinkOrigins, roles);
      }
    }
  }

  return roles;
}

function getRoleInputNodeIds(node, role, workflowLinkOrigins) {
  const ids = new Set();

  if (node.inputs && typeof node.inputs === "object" && !Array.isArray(node.inputs)) {
    const linkedId = getLinkedNodeId(node.inputs[role]);
    if (linkedId) {
      ids.add(linkedId);
    }
  }

  if (Array.isArray(node.inputs)) {
    for (const input of node.inputs) {
      const inputName = String(input?.name || input?.label || "").toLowerCase();
      if (inputName !== role) continue;
      const originId = workflowLinkOrigins.get(normalizeNodeId(input.link));
      if (originId) {
        ids.add(originId);
      }
    }
  }

  return [...ids];
}

function markLinkedPromptRole(startId, role, nodesById, workflowLinkOrigins, roles, seen = new Set()) {
  const id = normalizeNodeId(startId);
  if (!id || seen.has(id)) return;

  seen.add(id);
  assignLinkedPromptRole(roles, id, role);

  const node = nodesById.get(id);
  if (!node) return;

  for (const upstreamId of getInputNodeIds(node, workflowLinkOrigins)) {
    markLinkedPromptRole(upstreamId, role, nodesById, workflowLinkOrigins, roles, seen);
  }
}

function assignLinkedPromptRole(roles, id, role) {
  const currentRole = roles.get(id);
  if (!currentRole) {
    roles.set(id, role);
    return;
  }

  if (currentRole !== role) {
    roles.set(id, "mixed");
  }
}

function getInputNodeIds(node, workflowLinkOrigins) {
  const ids = new Set();

  if (node.inputs && typeof node.inputs === "object" && !Array.isArray(node.inputs)) {
    for (const value of Object.values(node.inputs)) {
      const linkedId = getLinkedNodeId(value);
      if (linkedId) {
        ids.add(linkedId);
      }
    }
  }

  if (Array.isArray(node.inputs)) {
    for (const input of node.inputs) {
      const links = Array.isArray(input?.links) ? input.links : [input?.link];
      for (const link of links) {
        const originId = workflowLinkOrigins.get(normalizeNodeId(link));
        if (originId) {
          ids.add(originId);
        }
      }
    }
  }

  return [...ids];
}

function buildWorkflowLinkOrigins(workflowJson) {
  const linkOrigins = new Map();
  if (!workflowJson || !Array.isArray(workflowJson.links)) {
    return linkOrigins;
  }

  for (const link of workflowJson.links) {
    if (Array.isArray(link)) {
      const [linkId, originId] = link;
      const key = normalizeNodeId(linkId);
      const value = normalizeNodeId(originId);
      if (key && value) {
        linkOrigins.set(key, value);
      }
      continue;
    }

    if (link && typeof link === "object") {
      const key = normalizeNodeId(link.id ?? link.link_id ?? link.linkId);
      const value = normalizeNodeId(link.origin_id ?? link.originId ?? link.from_node_id ?? link.fromNodeId);
      if (key && value) {
        linkOrigins.set(key, value);
      }
    }
  }

  return linkOrigins;
}

function getLinkedPromptRole(node, linkedRoles) {
  const candidates = [
    node.id,
    node._id,
    node.node_id,
    node.key,
    node.index,
  ];

  for (const candidate of candidates) {
    const key = normalizeNodeId(candidate);
    if (key && linkedRoles.has(key)) {
      return linkedRoles.get(key);
    }
  }

  return "";
}

function getLinkedNodeId(value) {
  if (Array.isArray(value) && value.length) {
    return normalizeNodeId(value[0]);
  }

  if (value && typeof value === "object") {
    return normalizeNodeId(value.node_id || value.nodeId || value.id || value[0]);
  }

  return "";
}

function normalizeNodeId(value) {
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}

function getNodeTitle(node) {
  return String(node.title || node._meta?.title || node.type || node.class_type || "");
}

function getNodeFields(node) {
  if (node.inputs && typeof node.inputs === "object" && !Array.isArray(node.inputs)) {
    return node.inputs;
  }

  if (Array.isArray(node.widgets_values)) {
    return Object.fromEntries(
      node.widgets_values.map((value, index) => [typeof value === "string" ? `text_widget_${index}` : `widget_${index}`, value]),
    );
  }

  return {};
}

function collectModelFields(fields, modelTags) {
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== "string") continue;
    const normalizedKey = key.toLowerCase();
    if ((normalizedKey.includes("ckpt") || normalizedKey.includes("model") || normalizedKey.includes("lora") || normalizedKey.includes("vae")) && !isMetadataLikeText(value)) {
      modelTags.add(cleanModelName(value));
    }
  }
}

function collectSamplerFields(fields, samplerTags) {
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const normalizedKey = key.toLowerCase();
    if (["sampler_name", "scheduler", "steps", "cfg", "seed"].includes(normalizedKey)) {
      samplerTags.add(`${key}: ${value}`);
    }
  }
}

function looksNegative(title, value) {
  const lowerTitle = title.toLowerCase();
  const lowerValue = value.toLowerCase();
  return lowerTitle.includes("negative") || lowerValue.startsWith("negative prompt:");
}

function parseA1111Parameters(parameters) {
  if (!parameters || typeof parameters !== "string") {
    return { positive: [], negative: [] };
  }

  const negativeMarker = "Negative prompt:";
  const stepsMarker = "\nSteps:";
  const negativeIndex = parameters.indexOf(negativeMarker);
  const stepsIndex = parameters.indexOf(stepsMarker);

  if (negativeIndex === -1) {
    return { positive: [parameters.slice(0, stepsIndex > -1 ? stepsIndex : undefined).trim()].filter(Boolean), negative: [] };
  }

  const positive = parameters.slice(0, negativeIndex).trim();
  const negativeStart = negativeIndex + negativeMarker.length;
  const negative = parameters.slice(negativeStart, stepsIndex > -1 ? stepsIndex : undefined).trim();
  return {
    positive: positive ? [positive] : [],
    negative: negative ? [negative] : [],
  };
}

function buildTags(metadata) {
  const tagMap = new Map();
  addTagsFromPrompt(metadata.positivePrompt, "positive", tagMap);
  addTagsFromPrompt(metadata.negativePrompt, "negative", tagMap);

  for (const model of metadata.modelTags || []) {
    addTag(tagMap, `model: ${model}`, "model");
  }

  for (const sampler of metadata.samplerTags || []) {
    addTag(tagMap, sampler, "sampler");
  }

  return [...tagMap.values()].slice(0, 80);
}

function pickInitialSavedTags(tags) {
  return (tags || [])
    .filter((tag) => tag.type === "positive")
    .filter((tag) => !isUtilityTag(tag.label))
    .slice(0, 36)
    .map((tag) => ({ label: tag.label, type: "saved" }));
}

function getDisplayTags(entry) {
  if (Array.isArray(entry.savedTags)) {
    return entry.savedTags;
  }

  return pickInitialSavedTags(entry.tags || []);
}

function hasCustomSavedTags(entry) {
  if (!entry?.savedTagsEdited || !Array.isArray(entry.savedTags)) {
    return false;
  }

  return !tagsHaveSameLabels(entry.savedTags, pickInitialSavedTags(entry.tags || []));
}

function tagsHaveSameLabels(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  return left.every((tag, index) => normalizeTag(tag?.label || tag).toLowerCase() === normalizeTag(right[index]?.label || right[index]).toLowerCase());
}

function getPositiveDisplayTags(entry) {
  return getDisplayTags(entry).filter((tag) => tag.type !== "negative" && !isLikelyNegativeOnlyTag(tag.label));
}

function normalizeSection(value) {
  return String(value)
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 6)
    .join("/")
    .slice(0, 96);
}

function normalizeCategoryLabel(value) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, 40);
}

function parseCategoryLabels(text) {
  return [
    ...new Set(
      String(text)
        .split(/[\n,，、;；]+/)
        .map(normalizeCategoryLabel)
        .filter(Boolean),
    ),
  ].slice(0, 24);
}

function normalizeDisplayName(value) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, 64);
}

function formatEntryTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";

  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getEntryDisplayName(entry) {
  return getStoredDisplayName(entry) || "未命名";
}

function getStoredDisplayName(entry) {
  const displayName = normalizeDisplayName(entry.displayName || "");
  if (displayName && (entry.displayNameEdited || !isDefaultFileNameDisplay(displayName, entry.name))) {
    return displayName;
  }

  return formatEntryTime(entry.sourceModifiedAt || entry.importedAt || entry.createdAt) || displayName || normalizeDisplayName(entry.name || "");
}

function isDefaultFileNameDisplay(displayName, fileName) {
  if (!displayName || !fileName) return false;
  const normalizedDisplay = normalizeFileNameStem(displayName);
  const normalizedFile = normalizeFileNameStem(fileName);
  return normalizedDisplay === normalizedFile || normalizeFileNameStem(displayName.replace(/\.(png|webp|jpe?g)$/i, "")) === normalizedFile;
}

function normalizeFileNameStem(value) {
  return String(value)
    .replace(/\.(png|webp|jpe?g)$/i, "")
    .replace(/[._\-\s]+/g, "")
    .toLowerCase();
}

function getEntryCategories(entry) {
  const fromCategories = Array.isArray(entry.categories) ? entry.categories : [];
  const fromSection = entry.section ? [entry.section] : [];
  return [...new Set([...fromCategories, ...fromSection].map(normalizeCategoryLabel).filter(Boolean))];
}

function getEntryCategoryText(entry) {
  return getEntryCategories(entry).join(", ");
}

function getKnownCategories() {
  const categories = new Set();
  for (const category of state.customCategories) {
    categories.add(normalizeCategoryLabel(category));
  }
  for (const entry of state.entries) {
    for (const category of getEntryCategories(entry)) {
      categories.add(category);
    }
  }
  return [...categories].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function isEntryInCategory(entry, category) {
  const active = normalizeCategoryLabel(category).toLowerCase();
  if (!active) return true;
  return getEntryCategories(entry).some((item) => item.toLowerCase() === active);
}

function isUtilityTag(label) {
  const lower = String(label).toLowerCase();
  return (
    lower.startsWith("model:") ||
    lower.startsWith("lora:") ||
    lower.startsWith("sampler") ||
    lower.startsWith("scheduler") ||
    lower.startsWith("steps:") ||
    lower.startsWith("cfg:") ||
    lower.startsWith("seed:")
  );
}

function isLikelyNegativeOnlyTag(label) {
  const lower = String(label).toLowerCase();
  return (
    lower.includes("worst quality") ||
    lower.includes("low quality") ||
    lower.includes("low resolution") ||
    lower.includes("poor hand") ||
    lower.includes("missing finger") ||
    lower.includes("six finger") ||
    lower.includes("extra finger") ||
    lower.includes("mutated hand") ||
    lower.includes("poorly drawn") ||
    lower.includes("bad anatomy") ||
    lower.includes("bad hands") ||
    lower.includes("blurry") ||
    lower.includes("jpeg artifacts")
  );
}

function tagsToText(tags) {
  return (tags || []).map((tag) => tag.label).join("\n");
}

function parseSavedTags(text) {
  const tagMap = new Map();
  for (const piece of String(text).split(/[\n,，]/)) {
    const label = normalizeTag(piece);
    if (!label) continue;
    const key = label.toLowerCase();
    if (!tagMap.has(key)) {
      tagMap.set(key, { label, type: "saved" });
    }
  }
  return [...tagMap.values()].slice(0, 80);
}

async function handleDialogAction(event) {
  const saveButton = event.target.closest("[data-save-tags-id]");
  if (saveButton) {
    await saveEditedTags(saveButton.dataset.saveTagsId);
    return;
  }

  const copyButton = event.target.closest("[data-copy-tags-id]");
  if (copyButton) {
    await copySavedTags(copyButton.dataset.copyTagsId);
    return;
  }

  const refreshButton = event.target.closest("[data-refresh-saved-tags-id]");
  if (refreshButton) {
    await refreshSavedTagsFromMetadata(refreshButton.dataset.refreshSavedTagsId);
    return;
  }

  const addPositiveButton = event.target.closest("[data-add-positive-tags-id]");
  if (addPositiveButton) {
    addPositiveTagsToEditor(addPositiveButton.dataset.addPositiveTagsId);
    return;
  }

  const rawTagButton = event.target.closest("[data-add-raw-tag]");
  if (rawTagButton) {
    addTagsToEditor([rawTagButton.dataset.addRawTag]);
    return;
  }

  const downloadButton = event.target.closest("[data-download-image-id]");
  if (downloadButton) {
    downloadOriginalImage(downloadButton.dataset.downloadImageId);
    return;
  }

  const deleteButton = event.target.closest("[data-delete-detail-id]");
  if (deleteButton) {
    if (blockLibraryMutation("删除图片")) return;
    const confirmed = window.confirm("确定删除这张 tag 参考图？");
    if (!confirmed) return;
    elements.detailDialog.close();
    await deleteEntry(deleteButton.dataset.deleteDetailId);
  }

}

async function handleDialogKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    const input = event.target.closest("#savedTagsInput");
    if (!input) return;
    event.preventDefault();
    const saveButton = elements.dialogContent.querySelector("[data-save-tags-id]");
    if (saveButton) {
      await saveEditedTags(saveButton.dataset.saveTagsId);
    }
  }
}

async function saveEditedTags(id) {
  if (!beginLibraryMutation("保存详情")) return;

  const entry = state.entries.find((item) => item.id === id);
  const input = document.querySelector("#savedTagsInput");
  const nameInput = document.querySelector("#displayNameInput");
  const categoryInput = document.querySelector("#categoryInput");
  const noteInput = document.querySelector("#noteInput");
  if (!entry || !input) {
    endLibraryMutation();
    return;
  }

  try {
    let directoryFailed = false;
    entry.savedTags = parseSavedTags(input.value);
    entry.savedTagsEdited = true;
    const nextDisplayName = normalizeDisplayName(nameInput?.value || "");
    entry.displayName = nextDisplayName;
    entry.displayNameEdited = Boolean(nextDisplayName);
    entry.categories = parseCategoryLabels(categoryInput?.value || "");
    entry.section = "";
    for (const category of entry.categories) {
      if (!state.customCategories.some((item) => item.toLowerCase() === category.toLowerCase())) {
        state.customCategories.push(category);
      }
    }
    saveCustomCategories();
    entry.note = String(noteInput?.value || "").trim();
    await saveEntry(entry);
    await loadEntries();
    render();
    if (state.directoryHandle) {
      try {
        await writeDirectoryIndex();
      } catch (error) {
        directoryFailed = true;
        console.error(error);
        showDirectorySyncFailure("目录索引同步");
      }
    }
    openDetail(id);
    if (!directoryFailed) {
      showToast("卡片信息已保存");
    }
  } finally {
    endLibraryMutation();
  }
}

async function copySavedTags(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;

  const text = getDisplayTags(entry).map((tag) => tag.label).join(", ");
  await copyText(text, "tag 已复制");
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    showToast("复制失败，可手动选中文本复制");
  }
}

function downloadOriginalImage(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry || !entry.imageBuffer) {
    showToast("原图数据不存在");
    return;
  }

  const fileName = getDownloadImageFileName(entry);
  const blob = new Blob([entry.imageBuffer], { type: entry.type || guessMimeType(fileName) });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("已开始下载原图");
}

async function refreshSavedTagsFromMetadata(id) {
  if (!beginLibraryMutation("重读元数据")) return;

  const entry = state.entries.find((item) => item.id === id);
  if (!entry) {
    endLibraryMutation();
    return;
  }

  try {
    let directoryFailed = false;
    const metadata = await readImageMetadata({ name: entry.name, type: entry.type }, entry.imageBuffer);
    const tags = buildTags(metadata);
    entry.parserVersion = PARSER_VERSION;
    entry.tags = tags;
    entry.savedTags = pickInitialSavedTags(tags);
    entry.savedTagsEdited = false;
    entry.positivePrompt = metadata.positivePrompt;
    entry.negativePrompt = metadata.negativePrompt;
    entry.modelTags = metadata.modelTags;
    entry.samplerTags = metadata.samplerTags;
    entry.rawMetadata = metadata.raw;

    await saveEntry(entry);
    await loadEntries();
    render();
    if (state.directoryHandle) {
      try {
        await writeDirectoryIndex();
      } catch (error) {
        directoryFailed = true;
        console.error(error);
        showDirectorySyncFailure("目录索引同步");
      }
    }
    openDetail(id);
    if (!directoryFailed) {
      showToast("已从图片元数据重新生成 tag");
    }
  } catch (error) {
    console.error(error);
    showToast("重新生成失败，图片元数据可能已损坏");
  } finally {
    endLibraryMutation();
  }
}

function addPositiveTagsToEditor(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  const labels = (entry.tags || []).filter((tag) => tag.type === "positive").map((tag) => tag.label);
  addTagsToEditor(labels);
}

function addTagsToEditor(labels) {
  const input = document.querySelector("#savedTagsInput");
  if (!input) return;

  const merged = parseSavedTags([input.value, ...labels].join("\n"));
  input.value = tagsToText(merged);
  input.focus();
  showToast("已加入编辑框，保存后更新卡片");
}

function handleCardDragStart(event) {
  if (state.blockCardDrag || isCardTextTarget(event.target) || event.target.closest(".image-tag-overlay")) {
    event.preventDefault();
    clearBlockedCardDrag();
    return;
  }

  const card = event.target.closest(".image-card");
  if (!card) return;

  const entry = state.entries.find((item) => item.id === card.dataset.entryId);
  if (!entry || !entry.imageBuffer || !event.dataTransfer) {
    event.preventDefault();
    return;
  }

  state.isDraggingCard = true;
  const fileName = getDownloadImageFileName(entry);
  const fileType = entry.type || guessMimeType(fileName);
  const file = new File([entry.imageBuffer], fileName, { type: fileType });

  event.dataTransfer.effectAllowed = "copy";

  try {
    event.dataTransfer.items.add(file);
  } catch {
    event.preventDefault();
    state.isDraggingCard = false;
    showToast("这个目标不支持直接拖入图片，可先导出或保存图片后再拖入");
  }
}

function handleGalleryPointerDown(event) {
  state.blockCardDrag = Boolean(isCardTextTarget(event.target) || event.target.closest(".image-tag-overlay"));
}

function clearBlockedCardDrag() {
  state.blockCardDrag = false;
}

function isCardTextTarget(target) {
  return Boolean(target.closest(".card-name-overlay, .overlay-tag, .overlay-empty"));
}

function openImageViewer(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;

  state.viewer.entryId = id;
  state.viewer.scale = 1;
  state.viewer.panX = 0;
  state.viewer.panY = 0;
  state.viewer.isPanning = false;
  state.viewer.pointerId = null;

  const objectUrl = getObjectUrl(entry);
  elements.imageViewerContent.innerHTML = `
    <div class="image-viewer-stage" data-viewer-stage>
      <img class="image-viewer-img" src="${objectUrl}" alt="${escapeHtml(entry.name)}" draggable="false" />
    </div>
  `;
  applyImageViewerTransform();

  if (!elements.imageViewerDialog.open) {
    elements.imageViewerDialog.showModal();
  }
}

function closeImageViewer() {
  if (elements.imageViewerDialog.open) {
    elements.imageViewerDialog.close();
  } else {
    clearImageViewer();
  }
}

function clearImageViewer() {
  state.viewer.entryId = "";
  state.viewer.scale = 1;
  state.viewer.panX = 0;
  state.viewer.panY = 0;
  state.viewer.isPanning = false;
  state.viewer.lastX = 0;
  state.viewer.lastY = 0;
  if (state.viewer.pointerId !== null) {
    try {
      elements.imageViewerContent.releasePointerCapture(state.viewer.pointerId);
    } catch {}
  }
  state.viewer.pointerId = null;
  elements.imageViewerContent.classList.remove("is-panning");
  elements.imageViewerContent.innerHTML = "";
}

function handleImageViewerWheel(event) {
  if (!elements.imageViewerDialog.open) return;
  event.preventDefault();

  const oldScale = state.viewer.scale;
  const delta = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  const nextScale = clamp(oldScale * delta, 0.35, 8);
  const rect = elements.imageViewerContent.getBoundingClientRect();
  const originX = event.clientX - rect.left - rect.width / 2;
  const originY = event.clientY - rect.top - rect.height / 2;
  const ratio = nextScale / oldScale;

  state.viewer.panX = originX - (originX - state.viewer.panX) * ratio;
  state.viewer.panY = originY - (originY - state.viewer.panY) * ratio;
  state.viewer.scale = nextScale;
  applyImageViewerTransform();
}

function handleImageViewerPointerDown(event) {
  if (!elements.imageViewerDialog.open || event.button !== 1) return;
  event.preventDefault();
  state.viewer.isPanning = true;
  state.viewer.pointerId = event.pointerId;
  state.viewer.lastX = event.clientX;
  state.viewer.lastY = event.clientY;
  elements.imageViewerContent.classList.add("is-panning");
  elements.imageViewerContent.setPointerCapture(event.pointerId);
}

function handleImageViewerPointerMove(event) {
  if (!state.viewer.isPanning) return;
  event.preventDefault();

  state.viewer.panX += event.clientX - state.viewer.lastX;
  state.viewer.panY += event.clientY - state.viewer.lastY;
  state.viewer.lastX = event.clientX;
  state.viewer.lastY = event.clientY;
  applyImageViewerTransform();
}

function handleImageViewerPointerEnd(event) {
  if (!state.viewer.isPanning) return;
  state.viewer.isPanning = false;
  state.viewer.pointerId = null;
  elements.imageViewerContent.classList.remove("is-panning");
  try {
    elements.imageViewerContent.releasePointerCapture(event.pointerId);
  } catch {}
}

function resetImageViewerTransform() {
  state.viewer.scale = 1;
  state.viewer.panX = 0;
  state.viewer.panY = 0;
  applyImageViewerTransform();
}

function applyImageViewerTransform() {
  const image = elements.imageViewerContent.querySelector(".image-viewer-img");
  if (!image) return;

  image.style.transform = `translate(${state.viewer.panX}px, ${state.viewer.panY}px) scale(${state.viewer.scale})`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function addTagsFromPrompt(prompt, type, tagMap) {
  if (!prompt) return;

  const loraMatches = [...prompt.matchAll(/<lora:([^:>]+)(?::[^>]*)?>/gi)];
  for (const match of loraMatches) {
    addTag(tagMap, `lora: ${match[1].trim()}`, "model");
  }

  const cleaned = prompt
    .replace(/<[^>]+>/g, ",")
    .replace(/\([^)]*:([0-9.]+)\)/g, " ")
    .replace(/[\n;]/g, ",");

  for (const piece of cleaned.split(",")) {
    const tag = normalizeTag(piece);
    if (tag) {
      addTag(tagMap, tag, type);
    }
  }
}

function addTag(tagMap, label, type) {
  const normalized = normalizeTag(label);
  if (!normalized) return;
  const key = normalized.toLowerCase();
  if (!tagMap.has(key)) {
    tagMap.set(key, { label: normalized, type, count: 1 });
  } else {
    tagMap.get(key).count += 1;
  }
}

function normalizeTag(value) {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/^[\s"'[{(]+|[\s"'\]})]+$/g, "")
    .trim()
    .slice(0, 72);
}

function uniqueText(values) {
  const seen = new Set();
  return values
    .map((value) => String(value).trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function parseMaybeJson(value) {
  if (!value || typeof value !== "string") return value && typeof value === "object" ? value : null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function cleanModelName(value) {
  return String(value).replace(/\.(safetensors|ckpt|pt|pth|bin)$/i, "").trim();
}

function readImageSize(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve({ width: 0, height: 0 });
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}

async function hashFile(buffer, name, lastModified) {
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return hex.slice(0, 24);
  }

  return `${name}-${lastModified}-${buffer.byteLength}`.replace(/\W+/g, "-");
}

function guessMimeType(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function isSupportedImageFile(file) {
  const guessedType = guessMimeType(file.name);
  return file.type.startsWith("image/") || guessedType === "image/png" || guessedType === "image/webp" || guessedType === "image/jpeg";
}

async function pickDirectory() {
  if (!("showDirectoryPicker" in window)) {
    showToast("当前浏览器不支持目录保存，可继续使用 IndexedDB 和导出索引");
    return;
  }

  if (state.isDirectorySyncing) {
    showToast("正在同步本地目录，请稍候");
    return;
  }

  if (state.isLibraryMutating) {
    showToast("正在处理本地库，请稍后再连接目录");
    return;
  }

  try {
    const nextDirectoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    await migrateLibraryToDirectory(nextDirectoryHandle);
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error(error);
      showToast("目录连接失败");
    }
  }
}

async function migrateLibraryToDirectory(directoryHandle) {
  const previousStatus = state.directoryHandle ? "目录同步" : "IndexedDB";
  const snapshot = createDirectorySyncSnapshot();
  const total = snapshot.entries.length;

  state.isDirectorySyncing = true;
  elements.pickFolderButton.disabled = true;
  elements.storageStatus.textContent = total ? `迁移 0/${total}` : "目录同步";

  try {
    const result = await syncAllToDirectory(directoryHandle, snapshot, (synced, count) => {
      elements.storageStatus.textContent = `迁移 ${synced}/${count}`;
    });
    state.directoryHandle = directoryHandle;
    elements.storageStatus.textContent = "目录同步";
    showToast(total ? `已把 ${result.synced} 张图片迁移到新目录` : "已连接本地目录，之后导入会自动保存");
  } catch (error) {
    console.error(error);
    elements.storageStatus.textContent = previousStatus;
    showDirectorySyncFailure("迁移到本地目录");
  } finally {
    state.isDirectorySyncing = false;
    elements.pickFolderButton.disabled = false;
  }
}

async function syncAllToDirectory(directoryHandle = state.directoryHandle, snapshot = createDirectorySyncSnapshot(), onProgress) {
  if (!directoryHandle) return { synced: 0 };

  let synced = 0;
  const total = snapshot.entries.length;
  for (const entry of snapshot.entries) {
    await syncEntryToDirectory(entry, directoryHandle);
    synced += 1;
    onProgress?.(synced, total);
  }
  await writeDirectoryIndex(directoryHandle, snapshot.portableData);

  return { synced };
}

async function syncEntryToDirectory(entry, directoryHandle = state.directoryHandle) {
  if (!directoryHandle) return;
  const imageDir = await directoryHandle.getDirectoryHandle("images", { create: true });
  const fileName = getDirectoryImageFileName(entry);
  const fileHandle = await imageDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(new Blob([entry.imageBuffer], { type: entry.type }));
  await writable.close();
}

async function deleteEntryImageFromDirectory(entry, directoryHandle = state.directoryHandle, throwOnFailure = false) {
  if (!directoryHandle || !entry) return;
  try {
    const imageDir = await directoryHandle.getDirectoryHandle("images", { create: false });
    await imageDir.removeEntry(getDirectoryImageFileName(entry));
  } catch (error) {
    if (error.name === "NotFoundError") return;
    if (throwOnFailure) {
      throw error;
    } else {
      console.warn("删除目录同步图片失败", entry.name, error);
    }
  }
}

async function deleteEntryImagesFromDirectory(entries, directoryHandle = state.directoryHandle) {
  let failed = false;
  if (!directoryHandle) return failed;

  for (const entry of entries) {
    try {
      await deleteEntryImageFromDirectory(entry, directoryHandle, true);
    } catch (error) {
      failed = true;
      console.warn("删除目录同步图片失败", entry.name, error);
    }
  }

  return failed;
}

async function writeDirectoryIndex(directoryHandle = state.directoryHandle, portableData = toPortableData()) {
  if (!directoryHandle) return;
  const fileHandle = await directoryHandle.getFileHandle(INDEX_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(portableData, null, 2));
  await writable.close();
}

function toPortableData() {
  return toPortableDataFromEntries(state.entries, state.customCategories);
}

function toPortableDataFromEntries(entries, categories) {
  return {
    categories,
    images: toPortableIndex(entries),
  };
}

function toPortableIndex(entries = state.entries) {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    displayName: getEntryDisplayName(entry),
    displayNameEdited: Boolean(entry.displayNameEdited),
    type: entry.type,
    size: entry.size,
    width: entry.width,
    height: entry.height,
    importedAt: entry.importedAt,
    sourceModifiedAt: entry.sourceModifiedAt || "",
    note: entry.note || "",
    section: entry.section || "",
    categories: getEntryCategories(entry),
    imagePath: `images/${getDirectoryImageFileName(entry)}`,
    tags: entry.tags,
    savedTags: getDisplayTags(entry),
    positivePrompt: entry.positivePrompt,
    negativePrompt: entry.negativePrompt,
    modelTags: entry.modelTags,
    samplerTags: entry.samplerTags,
    rawMetadata: entry.rawMetadata,
  }));
}

function createDirectorySyncSnapshot() {
  const entries = state.entries.map((entry) => ({ ...entry }));
  const categories = [...state.customCategories];
  return {
    entries,
    portableData: toPortableDataFromEntries(entries, categories),
  };
}

function safeFileName(name) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
}

function getDownloadImageFileName(entry) {
  const extension = getImageExtension(entry.type);
  const fallbackName = `${entry.id}${extension || ".png"}`;
  const fileName = safeFileName(entry.name || fallbackName);
  if (/\.(png|webp|jpe?g)$/i.test(fileName)) return fileName;
  return `${fileName}${extension}`;
}

function getImageExtension(type) {
  const normalizedType = String(type || "").toLowerCase();
  if (normalizedType === "image/png") return ".png";
  if (normalizedType === "image/webp") return ".webp";
  if (normalizedType === "image/jpeg" || normalizedType === "image/jpg") return ".jpg";
  return "";
}

function getDirectoryImageFileName(entry) {
  return `${entry.id}-${safeFileName(entry.name)}`;
}

function exportIndex() {
  const blob = new Blob([JSON.stringify(toPortableData(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = INDEX_FILE;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("索引已导出");
}

async function clearLibrary() {
  if (!beginLibraryMutation("清空本地库")) return;

  if (!state.entries.length) {
    endLibraryMutation();
    return;
  }
  const confirmed = window.confirm("确定清空浏览器本地保存的全部图片和标签？");
  if (!confirmed) {
    endLibraryMutation();
    return;
  }

  try {
    const entriesToDelete = [...state.entries];
    if (state.directoryHandle) {
      await writeDirectoryIndex(state.directoryHandle, toPortableDataFromEntries([], state.customCategories));
    }
    clearObjectUrls();
    await clearEntries();
    state.entries = [];
    render();
    const directoryDeleteFailed = await deleteEntryImagesFromDirectory(entriesToDelete);
    if (directoryDeleteFailed) {
      showToast("已清空本地库，目录里可能留下未引用的旧图片。重新选择同一目录可重试同步。");
    } else {
      showToast("已清空本地库");
    }
  } catch (error) {
    console.error(error);
    showDirectorySyncFailure("清空目录同步数据");
  } finally {
    endLibraryMutation();
  }
}

async function deleteEntry(id) {
  if (!beginLibraryMutation("删除图片")) return;

  const entry = state.entries.find((item) => item.id === id);
  if (!entry) {
    endLibraryMutation();
    return;
  }

  try {
    const nextEntries = state.entries.filter((item) => item.id !== id);
    if (state.directoryHandle) {
      await writeDirectoryIndex(state.directoryHandle, toPortableDataFromEntries(nextEntries, state.customCategories));
    }
    clearObjectUrl(id);
    await removeEntry(id);
    state.entries = nextEntries;
    render();
    const directoryDeleteFailed = await deleteEntryImagesFromDirectory([entry]);
    if (directoryDeleteFailed) {
      showToast("已删除卡片，目录里可能留下未引用的旧图片。重新选择同一目录可重试同步。");
    } else {
      showToast("已删除卡片");
    }
  } catch (error) {
    console.error(error);
    showDirectorySyncFailure("删除目录同步数据");
  } finally {
    endLibraryMutation();
  }
}

function getFilteredEntries() {
  const query = state.query;
  const tag = state.activeTag.toLowerCase();
  const category = normalizeCategoryLabel(state.activeSection);

  return state.entries.filter((entry) => {
    const positiveTags = getPositiveDisplayTags(entry);
    const categories = getEntryCategories(entry);
    const haystack = [
      ...positiveTags.map((item) => item.label),
      ...categories,
      getEntryDisplayName(entry),
      entry.note || "",
    ]
      .join(" ")
      .toLowerCase();

    const matchesQuery = !query || haystack.includes(query);
    const matchesTag = !tag || positiveTags.some((item) => item.label.toLowerCase() === tag);
    const matchesCategory = isEntryInCategory(entry, category);

    return matchesQuery && matchesTag && matchesCategory;
  });
}

function getSearchAndTagFilteredEntries() {
  const query = state.query;
  const tag = state.activeTag.toLowerCase();

  return state.entries.filter((entry) => {
    const positiveTags = getPositiveDisplayTags(entry);
    const categories = getEntryCategories(entry);
    const haystack = [
      ...positiveTags.map((item) => item.label),
      ...categories,
      getEntryDisplayName(entry),
      entry.note || "",
    ]
      .join(" ")
      .toLowerCase();

    const matchesQuery = !query || haystack.includes(query);
    const matchesTag = !tag || positiveTags.some((item) => item.label.toLowerCase() === tag);
    return matchesQuery && matchesTag;
  });
}

function render() {
  const filtered = getFilteredEntries();
  renderStats(filtered);
  renderSectionList();
  renderTagCloud();
  renderGallery(filtered);
}

function renderStats(filtered) {
  const uniqueTags = new Set(state.entries.flatMap((entry) => getPositiveDisplayTags(entry).map((tag) => tag.label.toLowerCase())));
  elements.totalCount.textContent = state.entries.length;
  elements.visibleCount.textContent = filtered.length;
  elements.tagCount.textContent = uniqueTags.size;
  elements.emptyState.classList.toggle("is-hidden", state.entries.length > 0);
}

function renderTagCloud() {
  const counts = new Map();
  for (const entry of state.entries) {
    for (const tag of getPositiveDisplayTags(entry)) {
      const key = tag.label.toLowerCase();
      counts.set(key, { label: tag.label, count: (counts.get(key)?.count || 0) + 1 });
    }
  }

  const tags = [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 28);

  elements.tagCloud.replaceChildren(
    ...tags.map((tag) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `tag-chip${state.activeTag.toLowerCase() === tag.label.toLowerCase() ? " is-active" : ""}`;
      button.textContent = `${tag.label} ${tag.count}`;
      button.title = tag.label;
      button.addEventListener("click", () => {
        state.activeTag = state.activeTag.toLowerCase() === tag.label.toLowerCase() ? "" : tag.label;
        elements.searchInput.value = "";
        state.query = "";
        render();
      });
      return button;
    }),
  );
}

function renderSectionList() {
  const categories = buildCategoryList();
  const allButton = createSectionButton({
    label: "全部",
    path: "",
    count: state.entries.length,
    active: state.activeSection === "",
    onClick: () => {
      state.activeSection = "";
      render();
    },
  });

  elements.sectionList.replaceChildren(
    allButton,
    ...categories.map((category) =>
      createSectionButton({
        label: category.label,
        path: category.label,
        count: category.count,
        active: normalizeCategoryLabel(state.activeSection).toLowerCase() === category.label.toLowerCase(),
        onClick: () => {
          state.activeSection = category.label;
          render();
        },
      }),
    ),
  );
}

function buildCategoryList() {
  const categories = new Map();
  const ensureCategory = (label) => {
    const normalized = normalizeCategoryLabel(label);
    if (!normalized) return null;
    const key = normalized.toLowerCase();
    if (!categories.has(key)) {
      categories.set(key, { label: normalized, count: 0 });
    }
    return categories.get(key);
  };

  for (const category of state.customCategories) {
    ensureCategory(category);
  }

  for (const entry of state.entries) {
    for (const category of getEntryCategories(entry)) {
      const item = ensureCategory(category);
      if (item) item.count += 1;
    }
  }

  return [...categories.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function createSectionButton({ label, path, count, active, onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `section-chip${active ? " is-active" : ""}`;
  button.innerHTML = `
    <span class="category-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M7 7h.01" />
        <path d="M4.6 4.6h6.8l8 8a2.2 2.2 0 0 1 0 3.1l-3.7 3.7a2.2 2.2 0 0 1-3.1 0l-8-8V4.6Z" />
      </svg>
    </span>
    <span class="category-name">${escapeHtml(label)}</span>
    <span class="category-count">${count}</span>
  `;
  button.title = path || label;
  button.addEventListener("click", onClick);
  return button;
}

function renderGallery(entries) {
  elements.gallery.classList.toggle("compact", state.view === "compact");
  elements.gallery.replaceChildren(...entries.map(createCard));
}

function createCard(entry) {
  const article = document.createElement("article");
  article.className = "image-card";
  article.dataset.entryId = entry.id;
  article.setAttribute("aria-label", entry.name);
  const tags = getPositiveDisplayTags(entry).slice(0, state.view === "compact" ? 18 : 36);
  const objectUrl = getObjectUrl(entry);
  const displayName = getEntryDisplayName(entry);

  article.innerHTML = `
    <button class="card-download-button" type="button" data-download-image-id="${entry.id}" title="下载原图" aria-label="下载原图">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
    </button>
    <button class="image-button" type="button" data-open-id="${entry.id}" title="点击图片放大，点击文字查看详情" draggable="true">
      <div class="image-frame">
        <img src="${objectUrl}" alt="${escapeHtml(entry.name)}" loading="lazy" draggable="false" />
        <div class="card-name-overlay" title="${escapeHtml(displayName)}" role="button" aria-label="查看图片详情">${escapeHtml(displayName)}</div>
        <div class="image-tag-overlay" aria-label="正向 tag" role="button" title="查看 tag 详情">
          ${
            tags.length
              ? tags
                  .map((tag) => `<span class="overlay-tag" title="${escapeHtml(tag.label)}">${escapeHtml(tag.label)}</span>`)
                  .join("")
              : '<span class="overlay-empty">点开图片编辑正向 tag</span>'
          }
        </div>
      </div>
    </button>
  `;

  return article;
}

function openDetail(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;

  const objectUrl = getObjectUrl(entry);
  const savedTags = getDisplayTags(entry);
  const categories = getKnownCategories();
  const displayName = getEntryDisplayName(entry);
  elements.dialogContent.innerHTML = `
    <div class="dialog-media">
      <img src="${objectUrl}" alt="${escapeHtml(entry.name)}" />
    </div>
    <div class="dialog-meta">
      <h3>${escapeHtml(entry.name)}</h3>
      <section class="card-info-editor" aria-label="图片备注和分类">
        <label class="field-label">
          <span>名称</span>
          <input id="displayNameInput" type="text" value="${escapeHtml(displayName)}" placeholder="默认使用导入时间" />
        </label>
        <label class="field-label">
          <span>分类标签</span>
          <input id="categoryInput" list="categoryOptions" type="text" value="${escapeHtml(getEntryCategoryText(entry))}" placeholder="例如：角色, 红发, 巫女服" />
        </label>
        <label class="field-label">
          <span>备注</span>
          <textarea id="noteInput" spellcheck="false" rows="3" placeholder="写下这个 tag 适合什么效果、用法或注意点">${escapeHtml(entry.note || "")}</textarea>
        </label>
        <datalist id="categoryOptions">
          ${categories.map((category) => `<option value="${escapeHtml(category)}"></option>`).join("")}
        </datalist>
      </section>
      <section class="saved-tags-editor" aria-label="收藏 tag 编辑器">
        <div class="detail-section-heading">
          <h4>卡片外显示的 tag</h4>
          <div class="detail-mini-actions">
            <button class="secondary-button compact-action" type="button" data-add-positive-tags-id="${entry.id}" title="把自动解析出的正向 tag 加入编辑框">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
              正向
            </button>
            <button class="secondary-button compact-action" type="button" data-copy-tags-id="${entry.id}" title="复制收藏 tag">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 8h10v12H8z" />
                <path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              复制
            </button>
            <button class="secondary-button compact-action" type="button" data-refresh-saved-tags-id="${entry.id}" title="重新读取这张图片的元数据并覆盖卡片 tag">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 11a8 8 0 0 0-14.4-4.8L4 8" />
                <path d="M4 4v4h4" />
                <path d="M4 13a8 8 0 0 0 14.4 4.8L20 16" />
                <path d="M20 20v-4h-4" />
              </svg>
              重读
            </button>
          </div>
        </div>
        <textarea id="savedTagsInput" spellcheck="false" rows="4" placeholder="一行一个 tag，或用逗号分隔">${escapeHtml(tagsToText(savedTags))}</textarea>
        <div class="detail-actions">
          <button class="secondary-button compact-action" type="button" data-download-image-id="${entry.id}" title="下载原图">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
            下载原图
          </button>
          <button class="secondary-button primary-action" type="button" data-save-tags-id="${entry.id}">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
              <path d="M7 3v6h8" />
              <path d="M7 21v-8h10v8" />
            </svg>
            保存卡片
          </button>
          <button class="secondary-button danger-action" type="button" data-delete-detail-id="${entry.id}">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16" />
              <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" />
              <path d="M18 7l-.7 11.2A2 2 0 0 1 15.3 20H8.7a2 2 0 0 1-2-1.8L6 7" />
            </svg>
            删除图片
          </button>
        </div>
      </section>
      <div class="detail-grid">
        <div class="detail-stat"><span>尺寸</span><strong>${entry.width || "-"} x ${entry.height || "-"}</strong></div>
        <div class="detail-stat"><span>大小</span><strong>${formatBytes(entry.size)}</strong></div>
        <div class="detail-stat"><span>类型</span><strong>${escapeHtml(entry.type)}</strong></div>
        <div class="detail-stat"><span>导入时间</span><strong>${new Date(entry.importedAt).toLocaleString()}</strong></div>
      </div>
      <div class="prompt-block">
        <h4>正向 Prompt</h4>
        <pre>${escapeHtml(entry.positivePrompt || "未读取到正向 prompt")}</pre>
      </div>
      <div class="prompt-block">
        <h4>负向 Prompt</h4>
        <pre>${escapeHtml(entry.negativePrompt || "未读取到负向 prompt")}</pre>
      </div>
      <div class="prompt-block">
        <h4>自动解析出的全部 tag</h4>
        <div class="tag-list detail-raw-tags">
          ${(entry.tags || [])
            .map(
              (tag) =>
                `<button class="card-tag tag-button ${tag.type === "negative" ? "negative" : ""}" type="button" data-add-raw-tag="${escapeHtml(tag.label)}" title="加入收藏 tag：${escapeHtml(tag.label)}">${escapeHtml(tag.label)}</button>`,
            )
            .join("")}
        </div>
      </div>
      <div class="prompt-block">
        <h4>原始元数据</h4>
        <pre>${escapeHtml(JSON.stringify(entry.rawMetadata || {}, null, 2))}</pre>
      </div>
    </div>
  `;

  if (!elements.detailDialog.open) {
    elements.detailDialog.showModal();
  }
}

function getObjectUrl(entry) {
  if (state.objectUrls.has(entry.id)) {
    return state.objectUrls.get(entry.id);
  }

  const url = URL.createObjectURL(new Blob([entry.imageBuffer], { type: entry.type }));
  state.objectUrls.set(entry.id, url);
  return url;
}

function clearObjectUrl(id) {
  const url = state.objectUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  state.objectUrls.delete(id);
}

function clearObjectUrls() {
  for (const url of state.objectUrls.values()) {
    URL.revokeObjectURL(url);
  }
  state.objectUrls.clear();
}

function applyViewMode() {
  elements.segments.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
  elements.gallery.classList.toggle("compact", state.view === "compact");
}

function formatBytes(bytes) {
  if (!bytes) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let toastTimer = 0;
function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2400);
}
