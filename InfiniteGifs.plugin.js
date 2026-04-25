/**
 * @name InfiniteGifs
 * @author VWilk
 * @authorId 363358047784927234
 * @version 2.2.0
 * @description Extracts GIF/media URLs from Discord/base64 data, downloads them as a zip, and adds a BetterGifs button to the expression picker.
 * @source https://github.com/VWilk/InfiniteGifsBD
 * @updateUrl https://raw.githubusercontent.com/VWilk/InfiniteGifsBD/main/InfiniteGifs.plugin.js
 */

const PLUGIN_ID = "InfiniteGifs";
const JSZIP_URL = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
const BUTTON_ID = "bettergifs-picker-tab";
const MODAL_ID = "bettergifs-modal";
const STYLE_ID = "bettergifs-styles";
const MEDIA_URL_RE = /https:\/\/[^\s"'`<>\\]+/gi;
const MEDIA_EXT_RE = /\.(gif|mp4|webm|webp|png|jpe?g)(?:$|[?#])/i;
const DISCORD_MEDIA_RE = /(?:cdn|media)\.discordapp\.(?:com|net)/i;
const KNOWN_MEDIA_HOST_RE = /(tenor\.com|giphy\.com)$/i;
const SETTINGS_PROTO_RE = /\/settings-proto\/2(?:[/?#]|$)/i;
const MYGIF_PREVIEW_CACHE_LIMIT = 80;
const MYGIF_LIBRARY_PAGE_SIZE = 36;
const DEFAULTS = {
    base64Data: ""
};

module.exports = class InfiniteGifs {
    constructor() {
        this.settings = this.loadData("settings", DEFAULTS);
        this.mediaUrls = this.loadData("media_urls", [])
            .map(url => this.resolvePreferredMediaUrl(url))
            .filter(url => this.isMediaUrl(url));
        this.myGifs = this.loadData("my_gifs", []).map(entry => this.normalizeMyGifEntry(entry)).filter(Boolean);
        this.modal = null;
        this.observer = null;
        this.unpatchContextMenu = null;
        this.abortController = null;
        this.originalFetch = null;
        this.originalXHROpen = null;
        this.originalXHRSend = null;
        this.panelRefreshers = new Set();
        this.favoriteScanTimer = null;
        this.favoriteCrawlRunning = false;
        this.favoriteCrawlToken = 0;
        this.lastAutoCrawlPanel = null;
        this.previewObjectUrls = new Map();
        this.previewLoads = new Map();
        this.deadMyGifIds = new Set();
        this.captureState = {
            lastUrl: "",
            lastSource: "",
            lastAdded: 0,
            lastSize: 0,
            lastCaptureAt: 0,
            lastPayloadText: "",
            lastPayloadVariants: [],
            lastTotalSeen: 0
        };
    }

    start() {
        this.injectStyles();
        this.observeGifPicker();
        this.injectPickerButton();
        this.patchMessageContextMenu();
        this.installNetworkInterceptors();
        if (this.settings.base64Data) {
            this.processInput(this.settings.base64Data).catch(error => this.logError("Startup processing failed", error));
        }
    }

    stop() {
        this.abortController?.abort();
        this.abortController = null;
        this.revokePreviewCache();
        clearTimeout(this.favoriteScanTimer);
        this.favoriteScanTimer = null;
        this.favoriteCrawlRunning = false;
        this.favoriteCrawlToken += 1;
        this.lastAutoCrawlPanel = null;
        this.unpatchContextMenu?.();
        this.unpatchContextMenu = null;
        this.uninstallNetworkInterceptors();
        this.observer?.disconnect();
        this.observer = null;
        this.panelRefreshers.clear();
        document.getElementById(BUTTON_ID)?.remove();
        this.closeModal();
        BdApi.DOM.removeStyle(STYLE_ID);
    }

    getSettingsPanel() {
        return this.buildSettingsPanel({ embedded: true });
    }

    loadData(key, fallback) {
        try {
            return BdApi.Data.load(PLUGIN_ID, key) ?? fallback;
        } catch (error) {
            this.logError(`Failed to load ${key}`, error);
            return fallback;
        }
    }

    saveData(key, value) {
        try {
            BdApi.Data.save(PLUGIN_ID, key, value);
        } catch (error) {
            this.logError(`Failed to save ${key}`, error);
        }
    }

    saveSettings() {
        this.saveData("settings", this.settings);
    }

    saveMediaUrls() {
        this.saveData("media_urls", this.mediaUrls);
    }

    saveMyGifs() {
        this.saveData("my_gifs", this.myGifs);
    }

    injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        BdApi.DOM.addStyle(STYLE_ID, `
            #${MODAL_ID} {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            }
            #${MODAL_ID} .bettergifs-panel {
                width: min(720px, calc(100vw - 32px));
                max-height: calc(100vh - 32px);
                overflow: auto;
                background: var(--background-primary, #313338);
                color: var(--text-normal, #dbdee1);
                border: 1px solid var(--border-subtle, #3f4147);
                border-radius: 12px;
                box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
            }
            .bettergifs-panel {
                padding: 16px;
            }
            .bettergifs-row {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
                margin-top: 12px;
            }
            .bettergifs-title {
                font-size: 18px;
                font-weight: 700;
                margin: 0 0 8px;
            }
            .bettergifs-subtitle {
                color: var(--text-muted, #b5bac1);
                font-size: 13px;
                margin-bottom: 12px;
            }
            .bettergifs-stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
                gap: 8px;
                margin-bottom: 12px;
            }
            .bettergifs-card {
                background: var(--background-secondary, #2b2d31);
                border-radius: 8px;
                padding: 10px;
            }
            .bettergifs-card strong {
                display: block;
                font-size: 18px;
                margin-bottom: 4px;
            }
            .bettergifs-textarea {
                width: 100%;
                min-height: 180px;
                resize: vertical;
                border: 1px solid var(--border-faint, #4e5058);
                border-radius: 8px;
                padding: 10px;
                box-sizing: border-box;
                background: var(--input-background, #1e1f22);
                color: var(--text-normal, #dbdee1);
                font-family: Consolas, monospace;
            }
            .bettergifs-status {
                margin-top: 10px;
                min-height: 18px;
                color: var(--text-muted, #b5bac1);
                font-size: 13px;
            }
            .bettergifs-btn {
                border: 0;
                border-radius: 8px;
                padding: 8px 12px;
                cursor: pointer;
                font-weight: 600;
                color: white;
            }
            .bettergifs-btn.primary { background: #5865f2; }
            .bettergifs-btn.success { background: #248046; }
            .bettergifs-btn.warn { background: #e67e22; }
            .bettergifs-btn.danger { background: #da373c; }
            .bettergifs-btn.ghost {
                background: var(--background-secondary, #2b2d31);
                color: var(--text-normal, #dbdee1);
                border: 1px solid var(--border-faint, #4e5058);
            }
            .bettergifs-section {
                margin-top: 16px;
                padding-top: 16px;
                border-top: 1px solid var(--border-subtle, #3f4147);
            }
            .bettergifs-section-title {
                font-size: 16px;
                font-weight: 700;
                margin: 0 0 6px;
            }
            .bettergifs-section-subtitle {
                color: var(--text-muted, #b5bac1);
                font-size: 12px;
                margin-bottom: 10px;
            }
            .bettergifs-input, .bettergifs-select {
                min-width: 0;
                flex: 1 1 140px;
                border: 1px solid var(--border-faint, #4e5058);
                border-radius: 8px;
                padding: 8px 10px;
                box-sizing: border-box;
                background: var(--input-background, #1e1f22);
                color: var(--text-normal, #dbdee1);
            }
            .bettergifs-library-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                gap: 10px;
                margin-top: 12px;
                max-height: 420px;
                overflow: auto;
                align-content: start;
            }
            .bettergifs-library-item {
                background: var(--background-secondary, #2b2d31);
                border: 1px solid var(--border-subtle, #3f4147);
                border-radius: 8px;
                overflow: hidden;
            }
            .bettergifs-library-preview {
                width: 100%;
                aspect-ratio: 1 / 1;
                background: rgba(0, 0, 0, 0.2);
                display: block;
                object-fit: cover;
            }
            .bettergifs-library-body {
                padding: 10px;
            }
            .bettergifs-library-name {
                font-weight: 700;
                margin-bottom: 4px;
                word-break: break-word;
            }
            .bettergifs-library-meta {
                color: var(--text-muted, #b5bac1);
                font-size: 12px;
                margin-bottom: 8px;
                word-break: break-word;
            }
            .bettergifs-tag-row {
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
                margin-bottom: 8px;
            }
            .bettergifs-tag {
                background: rgba(88, 101, 242, 0.18);
                color: var(--text-normal, #dbdee1);
                border-radius: 999px;
                padding: 2px 8px;
                font-size: 11px;
            }
            .bettergifs-empty {
                color: var(--text-muted, #b5bac1);
                font-size: 13px;
                padding: 16px 0 4px;
            }
            .bettergifs-picker-panel {
                width: min(1040px, calc(100vw - 24px));
                max-height: calc(100vh - 24px);
                padding: 14px;
                overflow: hidden;
            }
            .bettergifs-picker-shell {
                display: grid;
                grid-template-columns: minmax(0, 1fr) 280px;
                gap: 14px;
                min-height: 620px;
            }
            .bettergifs-picker-main,
            .bettergifs-picker-side {
                min-width: 0;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .bettergifs-picker-topbar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            }
            .bettergifs-picker-heading {
                font-size: 18px;
                font-weight: 700;
                margin: 0;
            }
            .bettergifs-picker-caption {
                color: var(--text-muted, #b5bac1);
                font-size: 12px;
            }
            .bettergifs-picker-actions {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
            }
            .bettergifs-toolbar {
                display: grid;
                grid-template-columns: minmax(0, 1.3fr) repeat(2, minmax(140px, 0.55fr));
                gap: 8px;
            }
            .bettergifs-chipbar {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
            }
            .bettergifs-chip {
                border: 1px solid var(--border-faint, #4e5058);
                background: var(--background-secondary, #2b2d31);
                color: var(--text-normal, #dbdee1);
                border-radius: 999px;
                padding: 5px 10px;
                cursor: pointer;
                font-size: 12px;
            }
            .bettergifs-chip.active {
                background: rgba(88, 101, 242, 0.22);
                border-color: rgba(88, 101, 242, 0.55);
            }
            .bettergifs-picker-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
                gap: 10px;
                overflow: auto;
                padding-right: 2px;
                align-content: start;
                min-height: 320px;
            }
            .bettergifs-picker-card {
                position: relative;
                border-radius: 8px;
                overflow: hidden;
                background: var(--background-secondary, #2b2d31);
                border: 1px solid var(--border-subtle, #3f4147);
                cursor: pointer;
                padding: 0;
                color: inherit;
                text-align: left;
            }
            .bettergifs-picker-card.active {
                border-color: rgba(88, 101, 242, 0.9);
                box-shadow: 0 0 0 1px rgba(88, 101, 242, 0.45);
            }
            .bettergifs-picker-card::after {
                content: "";
                position: absolute;
                inset: auto 0 0 0;
                height: 42%;
                background: linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0));
                pointer-events: none;
            }
            .bettergifs-picker-preview {
                width: 100%;
                aspect-ratio: 1 / 1;
                object-fit: cover;
                display: block;
                background: rgba(255,255,255,0.04);
            }
            .bettergifs-picker-skeleton {
                position: absolute;
                inset: 0;
                background: linear-gradient(90deg, rgba(255,255,255,0.05), rgba(255,255,255,0.11), rgba(255,255,255,0.05));
                background-size: 220px 100%;
                animation: bettergifsShimmer 1.25s linear infinite;
                pointer-events: none;
            }
            .bettergifs-picker-card.ready .bettergifs-picker-skeleton {
                display: none;
            }
            .bettergifs-picker-overlay {
                position: absolute;
                inset: auto 8px 8px 8px;
                display: flex;
                align-items: flex-end;
                justify-content: space-between;
                gap: 8px;
                z-index: 1;
            }
            .bettergifs-picker-label {
                min-width: 0;
            }
            .bettergifs-picker-name {
                font-size: 12px;
                font-weight: 700;
                color: white;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .bettergifs-picker-meta {
                color: rgba(255, 255, 255, 0.78);
                font-size: 11px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .bettergifs-picker-quick {
                display: flex;
                gap: 4px;
                opacity: 0;
                transition: opacity 120ms ease;
            }
            .bettergifs-picker-card:hover .bettergifs-picker-quick,
            .bettergifs-picker-card:focus-within .bettergifs-picker-quick,
            .bettergifs-picker-card.active .bettergifs-picker-quick {
                opacity: 1;
            }
            .bettergifs-mini-btn {
                border: 1px solid rgba(255,255,255,0.15);
                background: rgba(17, 18, 20, 0.78);
                color: white;
                border-radius: 7px;
                padding: 4px 8px;
                cursor: pointer;
                font-size: 11px;
            }
            .bettergifs-panel-card {
                background: var(--background-secondary, #2b2d31);
                border: 1px solid var(--border-subtle, #3f4147);
                border-radius: 8px;
                padding: 12px;
            }
            .bettergifs-side-title {
                font-size: 13px;
                font-weight: 700;
                margin-bottom: 8px;
            }
            .bettergifs-side-subtitle {
                color: var(--text-muted, #b5bac1);
                font-size: 12px;
                margin-bottom: 10px;
            }
            .bettergifs-detail-preview {
                width: 100%;
                aspect-ratio: 1 / 1;
                border-radius: 8px;
                object-fit: cover;
                background: rgba(255,255,255,0.04);
                display: block;
                margin-bottom: 10px;
            }
            .bettergifs-stack {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .bettergifs-countline {
                color: var(--text-muted, #b5bac1);
                font-size: 12px;
            }
            .bettergifs-collapse-head {
                width: 100%;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                border: 0;
                background: transparent;
                color: inherit;
                padding: 0;
                cursor: pointer;
                font: inherit;
            }
            .bettergifs-advanced {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .bettergifs-hidden {
                display: none !important;
            }
            @keyframes bettergifsShimmer {
                from { background-position: -220px 0; }
                to { background-position: 220px 0; }
            }
            @media (max-width: 900px) {
                .bettergifs-picker-panel {
                    width: min(100vw - 16px, 760px);
                }
                .bettergifs-picker-shell {
                    grid-template-columns: 1fr;
                    min-height: 0;
                }
                .bettergifs-toolbar {
                    grid-template-columns: 1fr;
                }
            }
        `);
    }

    observeGifPicker() {
        this.observer?.disconnect();
        this.observer = new MutationObserver(() => {
            this.injectPickerButton();
            this.scheduleFavoriteScan();
        });
        this.observer.observe(document.body, { childList: true, subtree: true });
    }

    injectPickerButton() {
        if (document.getElementById(BUTTON_ID)) return;

        const navList =
            document.querySelector('[aria-label="Expression Picker Categories"]') ||
            document.querySelector('[role="tablist"][aria-label*="Expression Picker"]');

        if (!navList) return;

        const template =
            navList.querySelector('[role="tab"]') ||
            navList.firstElementChild;

        const button = document.createElement("div");
        button.id = BUTTON_ID;
        button.role = "tab";
        button.tabIndex = 0;
        button.ariaLabel = "BetterGifs";
        button.ariaSelected = "false";
        button.className = template?.className || "";
        button.textContent = "BetterGifs";
        button.addEventListener("click", () => this.openModal());
        button.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                this.openModal();
            }
        });
        navList.appendChild(button);
    }

    patchMessageContextMenu() {
        try {
            this.unpatchContextMenu = BdApi.ContextMenu.patch("message", (tree, props) => {
                if (!props?.message) return tree;

                const urls = this.extractMediaFromMessage(props.message);
                if (!urls.length) return tree;

                tree.props.children.push(BdApi.ContextMenu.buildItem({
                    label: "InfiniteGifs",
                    children: [
                        {
                            label: `Add ${urls.length} media URL${urls.length === 1 ? "" : "s"}`,
                            action: () => this.addUrls(urls)
                        },
                        {
                            label: "Download as ZIP",
                            action: () => this.downloadUrlsAsZip(urls)
                        }
                    ]
                }));

                return tree;
            });
        } catch (error) {
            this.logError("Failed to patch message context menu", error);
        }
    }

    buildSettingsPanel({ embedded = false } = {}) {
        const root = document.createElement("div");
        root.className = "bettergifs-panel";

        const title = document.createElement("div");
        title.className = "bettergifs-title";
        title.textContent = embedded ? "InfiniteGifs" : "BetterGifs";

        const subtitle = document.createElement("div");
        subtitle.className = "bettergifs-subtitle";
        subtitle.textContent = "Capture URLs from the Discord GIF favourites tab, or paste raw protobuf/base64 text as a fallback.";

        const stats = document.createElement("div");
        stats.className = "bettergifs-stats";

        const textarea = document.createElement("textarea");
        textarea.className = "bettergifs-textarea";
        textarea.placeholder = "Paste Discord/base64/protobuf-looking text here...";
        textarea.value = this.settings.base64Data || "";

        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".txt,.json,.log";
        fileInput.style.display = "none";

        const librarySection = document.createElement("div");
        librarySection.className = "bettergifs-section";

        const libraryTitle = document.createElement("div");
        libraryTitle.className = "bettergifs-section-title";
        libraryTitle.textContent = "My GIFs";

        const librarySubtitle = document.createElement("div");
        librarySubtitle.className = "bettergifs-section-subtitle";
        librarySubtitle.textContent = "Keep a local library with folders and tags. This is the base we can later wire into its own picker view.";

        const libraryFormRow = document.createElement("div");
        libraryFormRow.className = "bettergifs-row";

        const libraryUrlInput = document.createElement("input");
        libraryUrlInput.className = "bettergifs-input";
        libraryUrlInput.placeholder = "GIF URL";

        const libraryTitleInput = document.createElement("input");
        libraryTitleInput.className = "bettergifs-input";
        libraryTitleInput.placeholder = "Title (optional)";

        const libraryFolderInput = document.createElement("input");
        libraryFolderInput.className = "bettergifs-input";
        libraryFolderInput.placeholder = "Folder";

        const libraryTagsInput = document.createElement("input");
        libraryTagsInput.className = "bettergifs-input";
        libraryTagsInput.placeholder = "Tags, comma separated";

        libraryFormRow.append(libraryUrlInput, libraryTitleInput, libraryFolderInput, libraryTagsInput);

        const libraryActionRow = document.createElement("div");
        libraryActionRow.className = "bettergifs-row";

        const librarySearchRow = document.createElement("div");
        librarySearchRow.className = "bettergifs-row";

        const librarySearchInput = document.createElement("input");
        librarySearchInput.className = "bettergifs-input";
        librarySearchInput.placeholder = "Search title, folder, tags, or URL";

        const libraryFolderFilter = document.createElement("select");
        libraryFolderFilter.className = "bettergifs-select";

        const libraryGrid = document.createElement("div");
        libraryGrid.className = "bettergifs-library-grid";
        let libraryRenderCount = MYGIF_LIBRARY_PAGE_SIZE;
        let libraryObserver = null;

        const status = document.createElement("div");
        status.className = "bettergifs-status";

        const cleanupLibraryObserver = () => {
            if (libraryObserver) {
                libraryObserver.disconnect();
                libraryObserver = null;
            }
            for (const node of libraryGrid.querySelectorAll(".bettergifs-library-preview")) {
                this.deactivatePreview(node);
            }
        };

        const renderLibraryGrid = () => {
            const previousFolder = libraryFolderFilter.value || "";
            libraryFolderFilter.replaceChildren();
            libraryFolderFilter.appendChild(new Option("All folders", ""));
            for (const folder of this.getMyGifFolders()) {
                libraryFolderFilter.appendChild(new Option(folder, folder));
            }
            libraryFolderFilter.value = [...libraryFolderFilter.options].some(option => option.value === previousFolder) ? previousFolder : "";

            const filtered = this.getFilteredMyGifs({
                query: librarySearchInput.value,
                folder: libraryFolderFilter.value
            });

            cleanupLibraryObserver();
            libraryGrid.replaceChildren();
            if (!filtered.length) {
                const empty = document.createElement("div");
                empty.className = "bettergifs-empty";
                empty.textContent = this.myGifs.length ? "No library items match the current filter." : "No local GIFs saved yet.";
                libraryGrid.appendChild(empty);
            } else {
                const visibleEntries = filtered.slice(0, libraryRenderCount);
                libraryObserver = new IntersectionObserver(entries => {
                    for (const intersection of entries) {
                        const preview = intersection.target;
                        if (intersection.isIntersecting) this.activatePreview(preview);
                        else this.deactivatePreview(preview);
                    }
                }, {
                    root: libraryGrid,
                    rootMargin: "160px 0px",
                    threshold: 0.01
                });

                for (const entry of visibleEntries) {
                    const card = this.createMyGifCard(entry, {
                        onCopy: async () => {
                            const copied = await this.copyText(entry.url);
                            if (copied) refreshStats("Copied GIF URL");
                        },
                        onOpen: () => {
                            window.open(entry.url, "_blank", "noopener,noreferrer");
                            refreshStats(`Opened ${entry.title || "GIF"}`);
                        },
                        onRemove: () => {
                            this.removeMyGif(entry.id);
                            refreshStats(`Removed ${entry.title || "GIF"} from My GIFs`);
                        }
                    });
                    libraryGrid.appendChild(card);
                    const preview = card.querySelector(".bettergifs-library-preview");
                    if (preview) libraryObserver.observe(preview);
                }
            }
        };

        const refreshStats = (message = "") => {
            const counts = this.getCounts();
            stats.replaceChildren(
                this.createStatCard("Stored", counts.total),
                this.createStatCard("GIF", counts.gif),
                this.createStatCard("MP4", counts.mp4),
                this.createStatCard("WEBM", counts.webm),
                this.createStatCard("My GIFs", this.myGifs.length)
            );

            renderLibraryGrid();
            status.textContent = message || this.formatCaptureStatus();
        };

        this.panelRefreshers.add(refreshStats);
        root.__betterGifsCleanup = () => {
            cleanupLibraryObserver();
            this.panelRefreshers.delete(refreshStats);
        };

        const persistTextarea = () => {
            this.settings.base64Data = textarea.value;
            this.saveSettings();
        };

        textarea.addEventListener("input", persistTextarea);

        fileInput.addEventListener("change", async event => {
            const file = event.target.files?.[0];
            if (!file) return;

            try {
                textarea.value = await file.text();
                persistTextarea();
                refreshStats(`Loaded ${file.name}`);
            } catch (error) {
                this.logError("Failed to read file", error);
                refreshStats("Failed to read file");
            }
        });

        const row1 = document.createElement("div");
        row1.className = "bettergifs-row";
        row1.append(
            this.createButton("Capture favourites", "primary", () => {
                const added = this.captureFavoritesFromDom({ source: "favourites-dom-manual", notify: true });
                refreshStats(added ? `Captured ${added} new favourite URL${added === 1 ? "" : "s"}` : "No new favourite URLs found in the open Favourites tab");
            }),
            this.createButton("Capture all favourites", "primary", async () => {
                if (this.favoriteCrawlRunning) {
                    refreshStats("Already scanning the full favourites list");
                    return;
                }
                refreshStats("Scanning the full favourites list...");
                const result = await this.captureAllFavorites(message => refreshStats(message));
                if (!result) {
                    refreshStats("Open the GIF Favourites tab first");
                    return;
                }
                refreshStats(`Full scan complete: saw ${result.seen} item${result.seen === 1 ? "" : "s"}, added ${result.added} new URL${result.added === 1 ? "" : "s"}`);
            }),
            this.createButton("Process input", "primary", async () => {
                persistTextarea();
                const added = await this.processInput(textarea.value);
                refreshStats(added ? `Added ${added} new URL${added === 1 ? "" : "s"}` : "No new media URLs found");
            }),
            this.createButton("Load file", "ghost", () => fileInput.click()),
            this.createButton("Export URLs", "success", () => {
                this.exportUrlList();
                refreshStats(`Exported ${this.mediaUrls.length} URL${this.mediaUrls.length === 1 ? "" : "s"}`);
            }),
            this.createButton("Download ZIP", "success", async () => {
                refreshStats("Downloading ZIP...");
                await this.downloadUrlsAsZip(this.mediaUrls, message => refreshStats(message));
            })
        );

        const row2 = document.createElement("div");
        row2.className = "bettergifs-row";
        row2.append(
            this.createButton("Process saved text", "warn", async () => {
                const added = await this.processInput(this.settings.base64Data || "");
                refreshStats(added ? `Added ${added} new URL${added === 1 ? "" : "s"}` : "No new media URLs found");
            }),
            this.createButton("Clear stored URLs", "danger", () => {
                this.mediaUrls = [];
                this.saveMediaUrls();
                refreshStats("Cleared stored URLs");
            }),
            this.createButton("Clear saved text", "ghost", () => {
                textarea.value = "";
                this.settings.base64Data = "";
                this.saveSettings();
                refreshStats("Cleared saved text");
            }),
            this.createButton("Save last proto capture", "ghost", () => {
                if (!this.captureState.lastPayloadText) {
                    refreshStats("No /settings-proto/2 payload captured yet");
                    return;
                }
                this.saveRawCapture();
                refreshStats("Saved last /settings-proto/2 payload");
            }),
            this.createButton("Process last proto capture", "warn", async () => {
                if (!this.captureState.lastPayloadText) {
                    refreshStats("No /settings-proto/2 payload captured yet");
                    return;
                }
                const added = await this.processCapturedPayload();
                refreshStats(added ? `Added ${added} new URL${added === 1 ? "" : "s"} from /settings-proto/2` : "No new media URLs found in last /settings-proto/2 capture");
            })
        );

        libraryActionRow.append(
            this.createButton("Add to My GIFs", "primary", () => {
                const result = this.upsertMyGif({
                    url: libraryUrlInput.value,
                    title: libraryTitleInput.value,
                    folder: libraryFolderInput.value,
                    tags: libraryTagsInput.value
                });
                if (!result) {
                    refreshStats("Enter a valid media URL for My GIFs");
                    return;
                }
                libraryUrlInput.value = "";
                libraryTitleInput.value = "";
                libraryTagsInput.value = "";
                refreshStats(`${result.created ? "Added" : "Updated"} ${result.entry.title || "GIF"} in My GIFs`);
            }),
            this.createButton("Import stored URLs", "success", async () => {
                refreshStats("Checking stored URLs before import...");
                const result = await this.importMediaUrlsToMyGifs({ folder: libraryFolderInput.value, tags: libraryTagsInput.value });
                if (result.added) {
                    refreshStats(`Imported ${result.added} stored URL${result.added === 1 ? "" : "s"} into My GIFs${result.skipped ? `, skipped ${result.skipped} unavailable` : ""}`);
                } else {
                    refreshStats(result.skipped ? `Skipped ${result.skipped} unavailable stored URL${result.skipped === 1 ? "" : "s"}` : "No new stored URLs to import");
                }
            }),
            this.createButton("Export My GIFs", "ghost", async () => {
                refreshStats("Checking My GIFs availability...");
                const result = await this.exportMyGifs();
                if (result?.exported) {
                    const skipped = result.skipped;
                    refreshStats(`Exported ${result.exported} My GIF${result.exported === 1 ? "" : "s"}${skipped ? `, skipped ${skipped} unavailable` : ""}`);
                } else if (result?.skipped) {
                    refreshStats(`Skipped ${result.skipped} unavailable GIF${result.skipped === 1 ? "" : "s"} and exported none`);
                }
            }),
            this.createButton("Clear My GIFs", "danger", () => {
                this.myGifs = [];
                this.saveMyGifs();
                refreshStats("Cleared My GIFs");
            })
        );

        librarySearchRow.append(librarySearchInput, libraryFolderFilter);

        librarySearchInput.addEventListener("input", () => {
            libraryRenderCount = MYGIF_LIBRARY_PAGE_SIZE;
            refreshStats();
        });
        libraryFolderFilter.addEventListener("change", () => {
            libraryRenderCount = MYGIF_LIBRARY_PAGE_SIZE;
            refreshStats();
        });
        libraryGrid.addEventListener("scroll", () => {
            const nearBottom = libraryGrid.scrollTop + libraryGrid.clientHeight >= libraryGrid.scrollHeight - 200;
            if (!nearBottom) return;

            const filteredCount = this.getFilteredMyGifs({
                query: librarySearchInput.value,
                folder: libraryFolderFilter.value
            }).length;
            if (libraryRenderCount >= filteredCount) return;

            libraryRenderCount = Math.min(filteredCount, libraryRenderCount + MYGIF_LIBRARY_PAGE_SIZE);
            renderLibraryGrid();
        });

        librarySection.append(
            libraryTitle,
            librarySubtitle,
            libraryFormRow,
            libraryActionRow,
            librarySearchRow,
            libraryGrid
        );

        root.append(title, subtitle, stats, textarea, fileInput, row1, row2, librarySection, status);

        if (!embedded) {
            const closeRow = document.createElement("div");
            closeRow.className = "bettergifs-row";
            closeRow.append(this.createButton("Close", "ghost", () => this.closeModal()));
            root.append(closeRow);
        }

        refreshStats();
        return root;
    }

    buildPickerPanel() {
        const root = document.createElement("div");
        root.className = "bettergifs-panel bettergifs-picker-panel";

        const hiddenFileInput = document.createElement("input");
        hiddenFileInput.type = "file";
        hiddenFileInput.accept = ".txt,.json,.log";
        hiddenFileInput.style.display = "none";

        const hiddenTextarea = document.createElement("textarea");
        hiddenTextarea.value = this.settings.base64Data || "";

        const shell = document.createElement("div");
        shell.className = "bettergifs-picker-shell";

        const main = document.createElement("div");
        main.className = "bettergifs-picker-main";

        const side = document.createElement("div");
        side.className = "bettergifs-picker-side";

        const topbar = document.createElement("div");
        topbar.className = "bettergifs-picker-topbar";

        const titleWrap = document.createElement("div");
        const title = document.createElement("div");
        title.className = "bettergifs-picker-heading";
        title.textContent = "My GIFs";
        const caption = document.createElement("div");
        caption.className = "bettergifs-picker-caption";
        caption.textContent = "Your library first. Import, capture, and maintenance stay tucked into Advanced.";
        titleWrap.append(title, caption);

        const topActions = document.createElement("div");
        topActions.className = "bettergifs-picker-actions";

        const toolbar = document.createElement("div");
        toolbar.className = "bettergifs-toolbar";

        const searchInput = document.createElement("input");
        searchInput.className = "bettergifs-input";
        searchInput.placeholder = "Search title, folder, tags, or URL";

        const folderSelect = document.createElement("select");
        folderSelect.className = "bettergifs-select";

        const tagInput = document.createElement("input");
        tagInput.className = "bettergifs-input";
        tagInput.placeholder = "Filter by tag";

        toolbar.append(searchInput, folderSelect, tagInput);

        const folderChips = document.createElement("div");
        folderChips.className = "bettergifs-chipbar";

        const addCard = document.createElement("div");
        addCard.className = "bettergifs-panel-card bettergifs-hidden";

        const addTitle = document.createElement("div");
        addTitle.className = "bettergifs-side-title";
        addTitle.textContent = "Add GIF";
        const addRow = document.createElement("div");
        addRow.className = "bettergifs-stack";

        const addUrlInput = document.createElement("input");
        addUrlInput.className = "bettergifs-input";
        addUrlInput.placeholder = "GIF URL";
        const addNameInput = document.createElement("input");
        addNameInput.className = "bettergifs-input";
        addNameInput.placeholder = "Title (optional)";
        const addFolderInput = document.createElement("input");
        addFolderInput.className = "bettergifs-input";
        addFolderInput.placeholder = "Folder";
        const addTagsInput = document.createElement("input");
        addTagsInput.className = "bettergifs-input";
        addTagsInput.placeholder = "Tags, comma separated";
        const addActions = document.createElement("div");
        addActions.className = "bettergifs-row";
        addRow.append(addUrlInput, addNameInput, addFolderInput, addTagsInput, addActions);
        addCard.append(addTitle, addRow);

        const grid = document.createElement("div");
        grid.className = "bettergifs-picker-grid";

        const statusLine = document.createElement("div");
        statusLine.className = "bettergifs-countline";

        const detailCard = document.createElement("div");
        detailCard.className = "bettergifs-panel-card";

        const advancedCard = document.createElement("div");
        advancedCard.className = "bettergifs-panel-card";
        const advancedHead = document.createElement("button");
        advancedHead.type = "button";
        advancedHead.className = "bettergifs-collapse-head";
        const advancedHeadLabel = document.createElement("div");
        const advancedTitle = document.createElement("div");
        advancedTitle.className = "bettergifs-side-title";
        advancedTitle.textContent = "Advanced";
        const advancedSubtitle = document.createElement("div");
        advancedSubtitle.className = "bettergifs-side-subtitle";
        advancedSubtitle.textContent = "Import, capture, cleanup, and protobuf tools.";
        advancedHeadLabel.append(advancedTitle, advancedSubtitle);
        const advancedToggleLabel = document.createElement("div");
        advancedToggleLabel.className = "bettergifs-countline";
        advancedHead.append(advancedHeadLabel, advancedToggleLabel);

        const advancedBody = document.createElement("div");
        advancedBody.className = "bettergifs-advanced bettergifs-hidden";

        const advancedText = document.createElement("textarea");
        advancedText.className = "bettergifs-textarea";
        advancedText.placeholder = "Paste Discord/base64/protobuf-looking text here...";
        advancedText.value = this.settings.base64Data || "";

        const advancedRow1 = document.createElement("div");
        advancedRow1.className = "bettergifs-row";
        const advancedRow2 = document.createElement("div");
        advancedRow2.className = "bettergifs-row";
        const advancedRow3 = document.createElement("div");
        advancedRow3.className = "bettergifs-row";

        advancedBody.append(advancedText, hiddenFileInput, advancedRow1, advancedRow2, advancedRow3);
        advancedCard.append(advancedHead, advancedBody);

        let selectedId = "";
        let pickerRenderCount = MYGIF_LIBRARY_PAGE_SIZE;
        let pickerObserver = null;
        let addOpen = false;
        let advancedOpen = false;

        const persistAdvancedTextarea = () => {
            this.settings.base64Data = advancedText.value;
            this.saveSettings();
            hiddenTextarea.value = advancedText.value;
        };

        advancedText.addEventListener("input", persistAdvancedTextarea);

        hiddenFileInput.addEventListener("change", async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
                advancedText.value = await file.text();
                persistAdvancedTextarea();
                refreshPicker(`Loaded ${file.name}`);
            } catch (error) {
                this.logError("Failed to read file", error);
                refreshPicker("Failed to read file");
            }
        });

        const cleanupPickerObserver = () => {
            if (pickerObserver) {
                pickerObserver.disconnect();
                pickerObserver = null;
            }
            for (const node of grid.querySelectorAll(".bettergifs-picker-preview")) {
                this.deactivatePreview(node);
            }
            const detailPreview = detailCard.querySelector(".bettergifs-detail-preview");
            if (detailPreview) this.deactivatePreview(detailPreview);
        };

        const getFilteredEntries = () => this.getFilteredMyGifs({
            query: searchInput.value,
            folder: folderSelect.value,
            tagQuery: tagInput.value
        });

        const syncFolderControls = () => {
            const previousFolder = folderSelect.value || "";
            folderSelect.replaceChildren();
            folderSelect.appendChild(new Option("All folders", ""));
            for (const folder of this.getMyGifFolders()) {
                folderSelect.appendChild(new Option(folder, folder));
            }
            folderSelect.value = [...folderSelect.options].some(option => option.value === previousFolder) ? previousFolder : "";

            const folders = this.getMyGifFolders();
            folderChips.replaceChildren();
            const makeChip = (label, value) => {
                const chip = document.createElement("button");
                chip.type = "button";
                chip.className = `bettergifs-chip${folderSelect.value === value ? " active" : ""}`;
                chip.textContent = label;
                chip.addEventListener("click", () => {
                    folderSelect.value = value;
                    pickerRenderCount = MYGIF_LIBRARY_PAGE_SIZE;
                    refreshPicker();
                });
                return chip;
            };
            folderChips.appendChild(makeChip("All", ""));
            for (const folder of folders.slice(0, 8)) {
                folderChips.appendChild(makeChip(folder, folder));
            }
        };

        const renderDetails = currentEntry => {
            const existingPreview = detailCard.querySelector(".bettergifs-detail-preview");
            if (existingPreview) this.deactivatePreview(existingPreview);
            detailCard.replaceChildren();

            const detailTitle = document.createElement("div");
            detailTitle.className = "bettergifs-side-title";
            detailTitle.textContent = currentEntry ? "Details" : "Library";

            const detailSubtitle = document.createElement("div");
            detailSubtitle.className = "bettergifs-side-subtitle";
            detailSubtitle.textContent = currentEntry
                ? "Edit metadata without leaving the browser."
                : "Select a GIF to edit title, folder, tags, or remove it.";

            detailCard.append(detailTitle, detailSubtitle);

            if (!currentEntry) return;

            const previewCandidates = this.getAvailabilityCandidates(currentEntry);
            const previewTag = previewCandidates.some(url => this.isVideoCandidate(url)) ? "video" : "img";
            const preview = document.createElement(previewTag);
            preview.className = "bettergifs-detail-preview";
            if (previewTag === "video") {
                preview.muted = true;
                preview.loop = true;
                preview.autoplay = true;
                preview.playsInline = true;
                preview.preload = "metadata";
            } else {
                preview.alt = currentEntry.title || "Selected GIF";
                preview.loading = "lazy";
            }
            preview.__betterGifsEntryId = currentEntry.id;
            preview.__betterGifsCandidates = previewCandidates;
            detailCard.appendChild(preview);
            this.activatePreview(preview);

            const titleInput = document.createElement("input");
            titleInput.className = "bettergifs-input";
            titleInput.value = currentEntry.title || "";
            titleInput.placeholder = "Title";

            const folderInput = document.createElement("input");
            folderInput.className = "bettergifs-input";
            folderInput.value = currentEntry.folder || "";
            folderInput.placeholder = "Folder";

            const tagsInput = document.createElement("input");
            tagsInput.className = "bettergifs-input";
            tagsInput.value = currentEntry.tags.join(", ");
            tagsInput.placeholder = "Tags, comma separated";

            const urlLine = document.createElement("div");
            urlLine.className = "bettergifs-countline";
            urlLine.textContent = currentEntry.url;

            const actionRow = document.createElement("div");
            actionRow.className = "bettergifs-row";
            actionRow.append(
                this.createButton("Save", "primary", () => {
                    const result = this.upsertMyGif({
                        id: currentEntry.id,
                        url: currentEntry.url,
                        sourceUrl: currentEntry.sourceUrl,
                        previewUrl: currentEntry.previewUrl,
                        createdAt: currentEntry.createdAt,
                        title: titleInput.value,
                        folder: folderInput.value,
                        tags: tagsInput.value
                    });
                    if (result?.entry) {
                        selectedId = result.entry.id;
                        refreshPicker(`Updated ${result.entry.title || "GIF"}`);
                    }
                }),
                this.createButton("Copy URL", "ghost", async () => {
                    const copied = await this.copyText(currentEntry.url);
                    if (copied) refreshPicker("Copied GIF URL");
                }),
                this.createButton("Open", "ghost", () => {
                    window.open(currentEntry.url, "_blank", "noopener,noreferrer");
                    refreshPicker(`Opened ${currentEntry.title || "GIF"}`);
                }),
                this.createButton("Remove", "danger", () => {
                    this.removeMyGif(currentEntry.id);
                    selectedId = "";
                    refreshPicker(`Removed ${currentEntry.title || "GIF"} from My GIFs`);
                })
            );

            detailCard.append(titleInput, folderInput, tagsInput, urlLine, actionRow);
        };

        const renderGrid = currentEntries => {
            cleanupPickerObserver();
            grid.replaceChildren();

            if (!currentEntries.length) {
                const empty = document.createElement("div");
                empty.className = "bettergifs-empty";
                empty.textContent = this.myGifs.length
                    ? "No GIFs match this filter."
                    : "Your library is empty. Add one or import from stored URLs.";
                grid.appendChild(empty);
                return;
            }

            const visibleEntries = currentEntries.slice(0, pickerRenderCount);
            pickerObserver = new IntersectionObserver(entries => {
                for (const intersection of entries) {
                    const preview = intersection.target;
                    if (intersection.isIntersecting) this.activatePreview(preview);
                    else this.deactivatePreview(preview);
                }
            }, {
                root: grid,
                rootMargin: "180px 0px",
                threshold: 0.01
            });

            for (const entry of visibleEntries) {
                const card = this.createPickerGifCard(entry, {
                    selected: entry.id === selectedId,
                    onSelect: () => {
                        selectedId = entry.id;
                        refreshPicker();
                    },
                    onCopy: async () => {
                        const copied = await this.copyText(entry.url);
                        if (copied) refreshPicker("Copied GIF URL");
                    },
                    onOpen: () => {
                        window.open(entry.url, "_blank", "noopener,noreferrer");
                        refreshPicker(`Opened ${entry.title || "GIF"}`);
                    },
                    onRemove: () => {
                        this.removeMyGif(entry.id);
                        if (selectedId === entry.id) selectedId = "";
                        refreshPicker(`Removed ${entry.title || "GIF"} from My GIFs`);
                    }
                });
                grid.appendChild(card);
                const preview = card.querySelector(".bettergifs-picker-preview");
                if (preview) pickerObserver.observe(preview);
            }
        };

        const refreshPicker = (message = "") => {
            syncFolderControls();
            const filtered = getFilteredEntries();

            if (!filtered.some(entry => entry.id === selectedId)) {
                selectedId = filtered[0]?.id || "";
            }

            renderGrid(filtered);
            renderDetails(filtered.find(entry => entry.id === selectedId) || null);
            statusLine.textContent = message || `${filtered.length} shown of ${this.myGifs.length} saved GIF${this.myGifs.length === 1 ? "" : "s"}`;
            addCard.classList.toggle("bettergifs-hidden", !addOpen);
            advancedBody.classList.toggle("bettergifs-hidden", !advancedOpen);
            advancedToggleLabel.textContent = advancedOpen ? "Hide" : "Show";
        };

        this.panelRefreshers.add(refreshPicker);
        root.__betterGifsCleanup = () => {
            cleanupPickerObserver();
            this.panelRefreshers.delete(refreshPicker);
        };

        const addToggleButton = this.createButton("Add GIF", "primary", () => {
            addOpen = !addOpen;
            refreshPicker();
        });
        const advancedToggleButton = this.createButton("Advanced", "ghost", () => {
            advancedOpen = !advancedOpen;
            refreshPicker();
        });
        const closeButton = this.createButton("Close", "ghost", () => this.closeModal());
        topActions.append(addToggleButton, advancedToggleButton, closeButton);
        topbar.append(titleWrap, topActions);

        addActions.append(
            this.createButton("Save", "primary", () => {
                const result = this.upsertMyGif({
                    url: addUrlInput.value,
                    title: addNameInput.value,
                    folder: addFolderInput.value,
                    tags: addTagsInput.value
                });
                if (!result) {
                    refreshPicker("Enter a valid media URL");
                    return;
                }
                selectedId = result.entry.id;
                addUrlInput.value = "";
                addNameInput.value = "";
                addTagsInput.value = "";
                addOpen = false;
                refreshPicker(`${result.created ? "Added" : "Updated"} ${result.entry.title || "GIF"}`);
            }),
            this.createButton("Cancel", "ghost", () => {
                addOpen = false;
                refreshPicker();
            })
        );

        advancedHead.addEventListener("click", () => {
            advancedOpen = !advancedOpen;
            refreshPicker();
        });

        advancedRow1.append(
            this.createButton("Import stored URLs", "success", async () => {
                refreshPicker("Checking stored URLs before import...");
                const result = await this.importMediaUrlsToMyGifs({ folder: addFolderInput.value, tags: addTagsInput.value });
                if (result.added) refreshPicker(`Imported ${result.added} stored URL${result.added === 1 ? "" : "s"}${result.skipped ? `, skipped ${result.skipped}` : ""}`);
                else refreshPicker(result.skipped ? `Skipped ${result.skipped} unavailable stored URL${result.skipped === 1 ? "" : "s"}` : "No new stored URLs to import");
            }),
            this.createButton("Export My GIFs", "ghost", async () => {
                refreshPicker("Checking My GIFs availability...");
                const result = await this.exportMyGifs();
                if (result?.exported) refreshPicker(`Exported ${result.exported} My GIF${result.exported === 1 ? "" : "s"}${result.skipped ? `, skipped ${result.skipped}` : ""}`);
                else if (result?.skipped) refreshPicker(`Skipped ${result.skipped} unavailable GIF${result.skipped === 1 ? "" : "s"} and exported none`);
            }),
            this.createButton("Clear My GIFs", "danger", () => {
                this.myGifs = [];
                this.saveMyGifs();
                selectedId = "";
                refreshPicker("Cleared My GIFs");
            })
        );

        advancedRow2.append(
            this.createButton("Capture favourites", "primary", () => {
                const added = this.captureFavoritesFromDom({ source: "favourites-dom-manual", notify: true });
                refreshPicker(added ? `Captured ${added} favourite URL${added === 1 ? "" : "s"}` : "No new favourite URLs found");
            }),
            this.createButton("Capture all favourites", "primary", async () => {
                if (this.favoriteCrawlRunning) {
                    refreshPicker("Already scanning the full favourites list");
                    return;
                }
                refreshPicker("Scanning the full favourites list...");
                const result = await this.captureAllFavorites(message => refreshPicker(message));
                if (!result) refreshPicker("Open the GIF Favourites tab first");
                else refreshPicker(`Full scan complete: saw ${result.seen} item${result.seen === 1 ? "" : "s"}, added ${result.added} new URL${result.added === 1 ? "" : "s"}`);
            }),
            this.createButton("Process input", "warn", async () => {
                persistAdvancedTextarea();
                const added = await this.processInput(advancedText.value);
                refreshPicker(added ? `Added ${added} new URL${added === 1 ? "" : "s"}` : "No new media URLs found");
            }),
            this.createButton("Load file", "ghost", () => hiddenFileInput.click())
        );

        advancedRow3.append(
            this.createButton("Process saved text", "ghost", async () => {
                const added = await this.processInput(this.settings.base64Data || "");
                refreshPicker(added ? `Added ${added} new URL${added === 1 ? "" : "s"}` : "No new media URLs found");
            }),
            this.createButton("Process last proto capture", "warn", async () => {
                if (!this.captureState.lastPayloadText) {
                    refreshPicker("No /settings-proto/2 payload captured yet");
                    return;
                }
                const added = await this.processCapturedPayload();
                refreshPicker(added ? `Added ${added} new URL${added === 1 ? "" : "s"} from /settings-proto/2` : "No new media URLs found in last /settings-proto/2 capture");
            }),
            this.createButton("Save last proto capture", "ghost", () => {
                if (!this.captureState.lastPayloadText) {
                    refreshPicker("No /settings-proto/2 payload captured yet");
                    return;
                }
                this.saveRawCapture();
                refreshPicker("Saved last /settings-proto/2 payload");
            }),
            this.createButton("Clear saved text", "ghost", () => {
                advancedText.value = "";
                this.settings.base64Data = "";
                this.saveSettings();
                refreshPicker("Cleared saved text");
            }),
            this.createButton("Clear stored URLs", "danger", () => {
                this.mediaUrls = [];
                this.saveMediaUrls();
                refreshPicker("Cleared stored URLs");
            })
        );

        searchInput.addEventListener("input", () => {
            pickerRenderCount = MYGIF_LIBRARY_PAGE_SIZE;
            refreshPicker();
        });
        folderSelect.addEventListener("change", () => {
            pickerRenderCount = MYGIF_LIBRARY_PAGE_SIZE;
            refreshPicker();
        });
        tagInput.addEventListener("input", () => {
            pickerRenderCount = MYGIF_LIBRARY_PAGE_SIZE;
            refreshPicker();
        });
        grid.addEventListener("scroll", () => {
            const nearBottom = grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 240;
            if (!nearBottom) return;
            const filteredCount = getFilteredEntries().length;
            if (pickerRenderCount >= filteredCount) return;
            pickerRenderCount = Math.min(filteredCount, pickerRenderCount + MYGIF_LIBRARY_PAGE_SIZE);
            renderGrid(getFilteredEntries());
        });

        main.append(topbar, toolbar, folderChips, addCard, grid, statusLine);
        side.append(detailCard, advancedCard);
        shell.append(main, side);
        root.append(shell);

        refreshPicker();
        return root;
    }

    createStatCard(label, value) {
        const card = document.createElement("div");
        card.className = "bettergifs-card";
        const strong = document.createElement("strong");
        strong.textContent = String(value);
        const name = document.createElement("span");
        name.textContent = label;
        card.append(strong, name);
        return card;
    }

    createButton(label, kind, onClick) {
        const button = document.createElement("button");
        button.className = `bettergifs-btn ${kind}`;
        button.textContent = label;
        button.addEventListener("click", onClick);
        return button;
    }

    createMiniButton(label, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "bettergifs-mini-btn";
        button.textContent = label;
        button.addEventListener("click", event => {
            event.stopPropagation();
            onClick?.(event);
        });
        return button;
    }

    createPickerGifCard(entry, actions = {}) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = `bettergifs-picker-card${actions.selected ? " active" : ""}`;
        card.addEventListener("click", () => actions.onSelect?.(entry));

        const previewCandidates = this.getAvailabilityCandidates(entry);
        const previewTag = previewCandidates.some(url => this.isVideoCandidate(url)) ? "video" : "img";
        const preview = document.createElement(previewTag);
        preview.className = "bettergifs-picker-preview";
        if (previewTag === "video") {
            preview.muted = true;
            preview.loop = true;
            preview.autoplay = true;
            preview.playsInline = true;
            preview.preload = "metadata";
        } else {
            preview.alt = entry.title || "Saved GIF";
            preview.loading = "lazy";
        }
        preview.__betterGifsEntryId = entry.id;
        preview.__betterGifsCandidates = previewCandidates;
        preview.addEventListener("loadeddata", () => card.classList.add("ready"), { once: true });
        preview.addEventListener("load", () => card.classList.add("ready"), { once: true });

        const skeleton = document.createElement("div");
        skeleton.className = "bettergifs-picker-skeleton";

        const overlay = document.createElement("div");
        overlay.className = "bettergifs-picker-overlay";

        const label = document.createElement("div");
        label.className = "bettergifs-picker-label";
        const name = document.createElement("div");
        name.className = "bettergifs-picker-name";
        name.textContent = entry.title || this.inferTitleFromUrl(entry.url);
        const meta = document.createElement("div");
        meta.className = "bettergifs-picker-meta";
        meta.textContent = entry.folder || (entry.tags[0] || this.getExtension(entry.url).toUpperCase());
        label.append(name, meta);

        const quick = document.createElement("div");
        quick.className = "bettergifs-picker-quick";
        quick.append(
            this.createMiniButton("Copy", () => actions.onCopy?.(entry)),
            this.createMiniButton("Open", () => actions.onOpen?.(entry)),
            this.createMiniButton("Remove", () => actions.onRemove?.(entry))
        );

        overlay.append(label, quick);
        card.append(preview, skeleton, overlay);
        return card;
    }

    revokePreviewCache() {
        for (const objectUrl of this.previewObjectUrls.values()) {
            try {
                URL.revokeObjectURL(objectUrl);
            } catch {}
        }
        this.previewObjectUrls.clear();
        this.previewLoads.clear();
    }

    activatePreview(element) {
        if (!element || element.__betterGifsActive) return;

        element.__betterGifsActive = true;
        element.__betterGifsIndex = 0;
        if (!element.__betterGifsOnError) {
            element.__betterGifsOnError = () => {
                if (!element.__betterGifsActive) return;
                if (this.isDiscordAttachmentUrl(element.__betterGifsCurrentCandidate || "")) {
                    this.removeMyGifOn404(element.__betterGifsEntryId);
                }
                element.__betterGifsIndex += 1;
                this.tryPreviewCandidate(element);
            };
            element.addEventListener("error", element.__betterGifsOnError);
        }

        this.tryPreviewCandidate(element);
    }

    deactivatePreview(element) {
        if (!element) return;
        element.__betterGifsActive = false;
        element.__betterGifsIndex = 0;
        if (element.tagName === "VIDEO") {
            try {
                element.pause();
                element.removeAttribute("src");
                element.load();
            } catch {}
        } else {
            element.removeAttribute("src");
        }
    }

    tryPreviewCandidate(element) {
        const candidates = element?.__betterGifsCandidates || [];
        const index = element?.__betterGifsIndex || 0;
        if (!element?.__betterGifsActive || index >= candidates.length) return;

        const candidate = candidates[index];
        element.__betterGifsCurrentCandidate = candidate;
        this.setMediaElementSource(element, candidate);
        this.cachePreviewCandidate(element.__betterGifsEntryId, candidate).then(objectUrl => {
            if (!element.isConnected || !element.__betterGifsActive) return;
            if (objectUrl) this.setMediaElementSource(element, objectUrl);
        }).catch(() => {});
    }

    setMediaElementSource(element, source) {
        if (!source) return;
        element.src = source;
        if (element.tagName === "VIDEO") {
            try {
                element.load();
                const promise = element.play?.();
                if (promise?.catch) promise.catch(() => {});
            } catch {}
        }
    }

    async cachePreviewCandidate(entryId, sourceUrl) {
        const cacheKey = `${entryId}:${sourceUrl}`;
        if (!this.isDiscordAttachmentUrl(sourceUrl) && this.previewObjectUrls.has(cacheKey)) {
            const objectUrl = this.previewObjectUrls.get(cacheKey);
            this.previewObjectUrls.delete(cacheKey);
            this.previewObjectUrls.set(cacheKey, objectUrl);
            return objectUrl;
        }
        if (this.previewLoads.has(cacheKey)) return this.previewLoads.get(cacheKey);

        const load = fetch(sourceUrl, {
            credentials: "omit",
            cache: this.isDiscordAttachmentUrl(sourceUrl) ? "no-store" : "force-cache"
        }).then(async response => {
            if (response.status === 404) this.removeMyGifOn404(entryId);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            if (await this.responseContainsUnavailableText(response)) throw new Error("Unavailable content");
            if (!this.isUsableMediaResponse(response, sourceUrl)) throw new Error("Not media");
            return response.blob();
        }).then(blob => {
            const objectUrl = URL.createObjectURL(blob);
            this.previewObjectUrls.set(cacheKey, objectUrl);
            this.prunePreviewCache();
            return objectUrl;
        }).finally(() => {
            this.previewLoads.delete(cacheKey);
        });

        this.previewLoads.set(cacheKey, load);
        return load;
    }

    getPreviewCandidates(entry) {
        const candidates = [
            ...(entry?.previewUrl ? [entry.previewUrl] : []),
            ...(entry?.url ? [entry.url] : []),
            ...(entry?.sourceUrl ? this.extractEmbeddedUrls(entry.sourceUrl) : [])
        ];
        return [...new Set(candidates.map(url => this.resolvePreferredMediaUrl(url)).filter(Boolean))];
    }

    getAvailabilityCandidates(entry) {
        const canonicalCandidates = [
            ...(entry?.url ? [this.resolvePreferredMediaUrl(entry.url) || this.normalizeUrl(entry.url)] : []),
            ...(entry?.previewUrl ? [this.resolvePreferredMediaUrl(entry.previewUrl) || this.normalizeUrl(entry.previewUrl)] : [])
        ].filter(Boolean);

        const canonicalDiscordUrl = canonicalCandidates.find(url => this.isDiscordAttachmentUrl(url));
        if (canonicalDiscordUrl) return [canonicalDiscordUrl];

        return this.getPreviewCandidates(entry);
    }

    extractEmbeddedUrls(text) {
        const found = [];
        for (const variant of this.expandTextVariants(String(text || ""))) {
            const starts = [...variant.matchAll(/https:\/\//gi)].map(match => match.index);
            if (!starts.length) continue;

            for (let i = 0; i < starts.length; i += 1) {
                const start = starts[i];
                const end = i + 1 < starts.length ? starts[i + 1] : variant.length;
                const segment = this.trimProtoUrlSegment(variant.slice(start, end));
                if (segment) found.push(segment);
            }
        }
        return [...new Set(found)];
    }

    trimProtoUrlSegment(segment) {
        if (!segment) return "";
        let value = segment.trim().replace(/[)\]}>,]+$/, "");
        value = value.split(/[\u0000-\u001f]/, 1)[0];

        const encodedControl = value.match(/%(?:0[0-9a-f]|1[0-9a-f])/i);
        if (encodedControl?.index >= 0) {
            value = value.slice(0, encodedControl.index);
        }

        return value.replace(/[.,;:]+$/, "");
    }

    resolvePreferredMediaUrl(input) {
        const candidates = this.extractEmbeddedUrls(input);
        if (!candidates.length && typeof input === "string" && input.startsWith("https://")) {
            candidates.push(this.trimProtoUrlSegment(input));
        }
        if (!candidates.length) return "";

        const ranked = candidates
            .map(url => this.basicNormalizeUrl(url))
            .filter(Boolean)
            .sort((a, b) => this.scoreMediaCandidate(b) - this.scoreMediaCandidate(a));

        return ranked[0] || "";
    }

    scoreMediaCandidate(url) {
        try {
            const parsed = new URL(url);
            const host = parsed.hostname.toLowerCase();
            const pathAndQuery = `${parsed.pathname}${parsed.search}`;
            let score = 0;

            if (MEDIA_EXT_RE.test(pathAndQuery)) score += 100;
            if (/^(media\.tenor\.com|media\d*\.giphy\.com|i\.giphy\.com|gif\.fxtwitter\.com)$/i.test(host)) score += 90;
            if (/^(cdn|media)\.discordapp\.(?:com|net)$/i.test(host)) score += 80;
            if (/^images-ext-\d+\.discordapp\.net$/i.test(host)) score += 60;
            if (host === "tenor.com" || host === "giphy.com") score -= 40;
            if (/\/(?:view|embed)\//i.test(parsed.pathname)) score -= 20;

            return score;
        } catch {
            return -Infinity;
        }
    }

    basicNormalizeUrl(url) {
        try {
            const parsed = new URL(url);
            for (const key of ["ex", "is", "hm", "width", "height", "format", "name"]) {
                parsed.searchParams.delete(key);
            }
            const sorted = [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
            parsed.search = new URLSearchParams(sorted).toString();
            return parsed.toString();
        } catch {
            return "";
        }
    }

    isVideoCandidate(url) {
        const ext = this.getExtension(url);
        if (/^(mp4|webm)$/i.test(ext)) return true;

        try {
            const host = new URL(url).hostname.toLowerCase();
            return /^(media\.tenor\.com|media\d*\.giphy\.com|i\.giphy\.com)$/i.test(host) && !/\.gif(?:$|[?#])/i.test(url);
        } catch {
            return false;
        }
    }

    isDiscordAttachmentUrl(url) {
        try {
            const parsed = new URL(url);
            if (!DISCORD_MEDIA_RE.test(parsed.hostname)) return false;
            return /^\/(?:attachments|stickers)\//i.test(parsed.pathname);
        } catch {
            return false;
        }
    }

    createMyGifCard(entry, actions = {}) {
        const card = document.createElement("div");
        card.className = "bettergifs-library-item";

        const previewCandidates = this.getAvailabilityCandidates(entry);
        const previewTag = previewCandidates.some(url => this.isVideoCandidate(url)) ? "video" : "img";
        const preview = document.createElement(previewTag);
        preview.className = "bettergifs-library-preview";
        if (previewTag === "video") {
            preview.muted = true;
            preview.loop = true;
            preview.autoplay = true;
            preview.playsInline = true;
            preview.preload = "metadata";
        } else {
            preview.alt = entry.title || "Saved GIF";
            preview.loading = "lazy";
        }
        preview.__betterGifsEntryId = entry.id;
        preview.__betterGifsCandidates = previewCandidates;

        const body = document.createElement("div");
        body.className = "bettergifs-library-body";

        const name = document.createElement("div");
        name.className = "bettergifs-library-name";
        name.textContent = entry.title || this.inferTitleFromUrl(entry.url);

        const meta = document.createElement("div");
        meta.className = "bettergifs-library-meta";
        meta.textContent = entry.folder ? `Folder: ${entry.folder}` : "No folder";

        const tagRow = document.createElement("div");
        tagRow.className = "bettergifs-tag-row";
        if (entry.tags.length) {
            for (const tag of entry.tags) {
                const pill = document.createElement("span");
                pill.className = "bettergifs-tag";
                pill.textContent = tag;
                tagRow.appendChild(pill);
            }
        }

        const actionRow = document.createElement("div");
        actionRow.className = "bettergifs-row";
        actionRow.append(
            this.createButton("Copy URL", "ghost", () => actions.onCopy?.(entry)),
            this.createButton("Open", "ghost", () => actions.onOpen?.(entry)),
            this.createButton("Remove", "danger", () => actions.onRemove?.(entry))
        );

        body.append(name, meta);
        if (entry.tags.length) body.append(tagRow);
        body.append(actionRow);
        card.append(preview, body);
        return card;
    }

    openModal() {
        if (this.modal?.isConnected) return;

        const modal = document.createElement("div");
        modal.id = MODAL_ID;
        modal.addEventListener("click", event => {
            if (event.target === modal) this.closeModal();
        });

        modal.appendChild(this.buildPickerPanel());
        document.body.appendChild(modal);
        this.modal = modal;
        this.scheduleFavoriteScan();
    }

    closeModal() {
        this.modal?.firstElementChild?.__betterGifsCleanup?.();
        this.modal?.remove();
        this.modal = null;
    }

    normalizeMyGifEntry(entry) {
        if (!entry?.url || !this.isMediaUrl(entry.url)) return null;
        const sourceUrl = typeof entry.sourceUrl === "string" && entry.sourceUrl.trim() ? entry.sourceUrl.trim() : entry.url;
        const url = this.resolvePreferredMediaUrl(entry.url) || this.normalizeUrl(entry.url);
        const previewUrl = this.resolvePreferredMediaUrl(entry.previewUrl || sourceUrl || url) || url;
        const title = typeof entry.title === "string" ? entry.title.trim() : "";
        const folder = typeof entry.folder === "string" ? entry.folder.trim() : "";
        const tags = this.parseTags(Array.isArray(entry.tags) ? entry.tags.join(",") : entry.tags || "");
        return {
            id: typeof entry.id === "string" && entry.id ? entry.id : this.makeId(),
            url,
            sourceUrl,
            previewUrl,
            title: title || this.inferTitleFromUrl(url),
            folder,
            tags,
            createdAt: Number(entry.createdAt) || Date.now()
        };
    }

    parseTags(input) {
        return [...new Set(String(input || "")
            .split(",")
            .map(tag => tag.trim().toLowerCase())
            .filter(Boolean))];
    }

    makeId() {
        return `gif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    inferTitleFromUrl(url) {
        try {
            const parsed = new URL(url);
            return decodeURIComponent(parsed.pathname.split("/").pop() || "Untitled GIF")
                .replace(/\.[a-z0-9]+$/i, "")
                .replace(/[_-]+/g, " ")
                .trim() || "Untitled GIF";
        } catch {
            return "Untitled GIF";
        }
    }

    upsertMyGif(entry) {
        const normalized = this.normalizeMyGifEntry(entry);
        if (!normalized) return null;

        const existingIndex = this.myGifs.findIndex(item => item.url === normalized.url);
        const created = existingIndex === -1;
        if (created) {
            this.myGifs = [normalized, ...this.myGifs];
        } else {
            this.myGifs[existingIndex] = {
                ...this.myGifs[existingIndex],
                ...normalized,
                id: this.myGifs[existingIndex].id,
                createdAt: this.myGifs[existingIndex].createdAt
            };
        }
        this.saveMyGifs();
        return { created, entry: created ? normalized : this.myGifs[existingIndex] };
    }

    removeMyGif(id) {
        const before = this.myGifs.length;
        this.myGifs = this.myGifs.filter(entry => entry.id !== id);
        if (this.myGifs.length !== before) this.saveMyGifs();
        return before - this.myGifs.length;
    }

    removeMyGifOn404(id) {
        if (!id || this.deadMyGifIds.has(id)) return 0;
        this.deadMyGifIds.add(id);
        for (const [cacheKey, objectUrl] of this.previewObjectUrls.entries()) {
            if (!cacheKey.startsWith(`${id}:`)) continue;
            this.previewObjectUrls.delete(cacheKey);
            try {
                URL.revokeObjectURL(objectUrl);
            } catch {}
        }
        const removed = this.removeMyGif(id);
        if (removed) this.refreshPanels("Removed unavailable GIF from My GIFs");
        return removed;
    }

    getMyGifFolders() {
        return [...new Set(this.myGifs.map(entry => entry.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    }

    getFilteredMyGifs({ query = "", folder = "", tagQuery = "" } = {}) {
        const normalizedQuery = query.trim().toLowerCase();
        const normalizedTagQuery = tagQuery.trim().toLowerCase();
        return this.myGifs.filter(entry => {
            if (folder && entry.folder !== folder) return false;
            if (normalizedTagQuery && !entry.tags.some(tag => tag.includes(normalizedTagQuery))) return false;
            if (!normalizedQuery) return true;
            const haystack = [entry.title, entry.folder, entry.url, ...entry.tags].join(" ").toLowerCase();
            return haystack.includes(normalizedQuery);
        });
    }

    async importMediaUrlsToMyGifs({ folder = "", tags = "" } = {}) {
        let added = 0;
        let skipped = 0;

        for (const url of this.mediaUrls) {
            const candidateEntry = this.normalizeMyGifEntry({ url, folder, tags });
            if (!candidateEntry) {
                skipped += 1;
                continue;
            }

            const candidates = this.getAvailabilityCandidates(candidateEntry);
            const requiresImportCheck = candidates.some(candidate => this.isDiscordAttachmentUrl(candidate));
            if (requiresImportCheck) {
                let ok = false;
                for (const candidate of candidates) {
                    if (await this.checkMediaAvailability(candidate)) {
                        ok = true;
                        break;
                    }
                }

                if (!ok) {
                    skipped += 1;
                    continue;
                }
            }

            const result = this.upsertMyGif({ url, folder, tags });
            if (result?.created) added += 1;
        }
        return { added, skipped };
    }

    async checkMediaAvailability(url, entryId = "") {
        try {
            const response = await fetch(url, {
                credentials: "omit",
                cache: "no-store"
            });
            if (response.status === 404) this.removeMyGifOn404(entryId);
            if (!response.ok) return false;
            if (await this.responseContainsUnavailableText(response)) return false;

            return this.isUsableMediaResponse(response, url);
        } catch {
            return false;
        }
    }

    async responseContainsUnavailableText(response) {
        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        if (!/text\/html|text\/plain/.test(contentType)) return false;

        try {
            const text = await response.clone().text();
            return /This content is no longer available\.?/i.test(text);
        } catch {
            return false;
        }
    }

    isUsableMediaResponse(response, url = "") {
        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        const contentLength = Number(response.headers.get("content-length") || 0);
        if (contentLength === 0) return false;
        if (contentType) return /^image\/|^video\//.test(contentType);
        return MEDIA_EXT_RE.test(url);
    }

    prunePreviewCache() {
        while (this.previewObjectUrls.size > MYGIF_PREVIEW_CACHE_LIMIT) {
            const oldestKey = this.previewObjectUrls.keys().next().value;
            if (!oldestKey) break;
            const objectUrl = this.previewObjectUrls.get(oldestKey);
            this.previewObjectUrls.delete(oldestKey);
            if (objectUrl) {
                try {
                    URL.revokeObjectURL(objectUrl);
                } catch {}
            }
        }
    }

    async getAvailableMyGifs() {
        const available = [];
        let skipped = 0;

        for (const entry of this.myGifs) {
            const candidates = this.getAvailabilityCandidates(entry);
            let ok = false;
            for (const candidate of candidates) {
                if (await this.checkMediaAvailability(candidate, entry.id)) {
                    ok = true;
                    break;
                }
            }

            if (ok) available.push(entry);
            else skipped += 1;
        }

        return { available, skipped };
    }

    async exportMyGifs() {
        if (!this.myGifs.length) {
            this.notice("No My GIFs to export", "warning");
            return { exported: 0, skipped: 0 };
        }

        const { available, skipped } = await this.getAvailableMyGifs();
        if (!available.length) {
            this.notice("No available My GIFs to export", "warning");
            return { exported: 0, skipped };
        }

        const content = JSON.stringify(available, null, 2);
        const filename = `InfiniteGifs_MyGifs_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        this.saveBlob(new Blob([content], { type: "application/json;charset=utf-8" }), filename);
        this.notice(`Exported ${available.length} My GIF${available.length === 1 ? "" : "s"}${skipped ? `, skipped ${skipped} unavailable` : ""}`, skipped ? "warning" : "success");
        return { exported: available.length, skipped };
    }

    async copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            this.logError("Failed to copy text", error);
            this.notice("Could not copy URL", "error");
            return false;
        }
    }

    scheduleFavoriteScan() {
        clearTimeout(this.favoriteScanTimer);
        this.favoriteScanTimer = setTimeout(() => {
            this.captureFavoritesFromDom({ source: "favourites-dom-auto", notify: false });
            // Keep passive scanning of visible items, but do not auto-scroll the favourites view.
        }, 150);
    }

    getFavoritesPanel() {
        const panel = document.querySelector('#gif-picker-tab-panel[role="tabpanel"]');
        if (!panel) return null;

        const heading = panel.querySelector("h3");
        if (!heading) return null;

        const title = heading.textContent?.trim().toLowerCase();
        return title === "favourites" || title === "favorites" ? panel : null;
    }

    getFavoritesScroller(panel = this.getFavoritesPanel()) {
        if (!panel) return null;

        const candidates = [panel, ...panel.querySelectorAll("div")];
        let best = null;

        for (const node of candidates) {
            if (!(node instanceof HTMLElement)) continue;
            if (node.scrollHeight <= node.clientHeight + 20) continue;
            if (!best || node.scrollHeight > best.scrollHeight) best = node;
        }

        return best;
    }

    captureFavoritesFromDom({ source = "favourites-dom", notify = false } = {}) {
        const panel = this.getFavoritesPanel();
        if (!panel) return 0;

        const urls = [...panel.querySelectorAll("img[src], video[src], source[src]")]
            .map(node => node.currentSrc || node.src || node.getAttribute("src") || "")
            .filter(Boolean)
            .filter(url => this.isMediaUrl(url))
            .map(url => this.normalizeUrl(url));

        const uniqueUrls = [...new Set(urls)];
        const added = this.addUrls(uniqueUrls);

        this.captureState = {
            ...this.captureState,
            lastUrl: uniqueUrls[0] || "",
            lastSource: source,
            lastAdded: added,
            lastSize: uniqueUrls.length,
            lastCaptureAt: Date.now(),
            lastTotalSeen: uniqueUrls.length
        };

        if (notify && added > 0) {
            this.notice(`Captured ${added} new favourite URL${added === 1 ? "" : "s"}`, "success");
        }

        this.refreshPanels();
        return added;
    }

    maybeStartAutoFavoriteCrawl() {
        const panel = this.getFavoritesPanel();
        if (!panel) {
            this.lastAutoCrawlPanel = null;
            return;
        }

        if (this.favoriteCrawlRunning) return;
        if (this.lastAutoCrawlPanel === panel) return;

        this.lastAutoCrawlPanel = panel;
        this.captureAllFavorites(message => this.refreshPanels(message)).catch(error => {
            this.logError("Automatic favourites crawl failed", error);
            if (this.lastAutoCrawlPanel === panel) this.lastAutoCrawlPanel = null;
        });
    }

    async captureAllFavorites(onProgress = () => {}) {
        const panel = this.getFavoritesPanel();
        const scroller = this.getFavoritesScroller(panel);
        if (!panel || !scroller) return null;

        const token = ++this.favoriteCrawlToken;
        this.favoriteCrawlRunning = true;

        const startTop = scroller.scrollTop;
        const startCount = this.mediaUrls.length;
        let maxSeen = 0;
        let stagnantPasses = 0;
        let previousTop = -1;

        try {
            for (let step = 0; step < 240; step += 1) {
                if (token !== this.favoriteCrawlToken) return null;

                this.captureFavoritesFromDom({ source: "favourites-dom-crawl", notify: false });
                maxSeen = Math.max(maxSeen, this.captureState.lastTotalSeen || 0);
                onProgress(`Scanning favourites... step ${step + 1}`);

                const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
                if (atBottom) {
                    stagnantPasses += 1;
                    if (stagnantPasses >= 3) break;
                } else {
                    stagnantPasses = 0;
                }

                previousTop = scroller.scrollTop;
                scroller.scrollTop = Math.min(scroller.scrollTop + Math.max(200, Math.floor(scroller.clientHeight * 0.85)), scroller.scrollHeight);
                scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
                await this.delay(250);

                if (scroller.scrollTop === previousTop) {
                    stagnantPasses += 1;
                    if (stagnantPasses >= 3) break;
                }
            }

            this.captureFavoritesFromDom({ source: "favourites-dom-crawl", notify: false });
            maxSeen = Math.max(maxSeen, this.captureState.lastTotalSeen || 0);
            return {
                seen: maxSeen,
                added: this.mediaUrls.length - startCount
            };
        } finally {
            scroller.scrollTop = startTop;
            scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
            this.favoriteCrawlRunning = false;
            if (!this.getFavoritesPanel()) {
                this.lastAutoCrawlPanel = null;
            }
            this.refreshPanels();
        }
    }

    installNetworkInterceptors() {
        if (!this.originalFetch && typeof window.fetch === "function") {
            this.originalFetch = window.fetch.bind(window);
            window.fetch = async (...args) => {
                const response = await this.originalFetch(...args);
                this.inspectNetworkResponse("fetch", args[0], response).catch(error => this.logError("Fetch inspection failed", error));
                return response;
            };
        }

        if (!this.originalXHROpen && !this.originalXHRSend && window.XMLHttpRequest?.prototype) {
            const proto = window.XMLHttpRequest.prototype;
            this.originalXHROpen = proto.open;
            this.originalXHRSend = proto.send;

            proto.open = function(method, url, ...rest) {
                this.__betterGifsUrl = url;
                return proto.open.__original.call(this, method, url, ...rest);
            };
            proto.open.__original = this.originalXHROpen;

            proto.send = function(...args) {
                this.addEventListener("load", () => {
                    const plugin = window[`${PLUGIN_ID}_instance`];
                    plugin?.inspectXhrResponse(this).catch(error => plugin?.logError("XHR inspection failed", error));
                }, { once: true });
                return proto.send.__original.apply(this, args);
            };
            proto.send.__original = this.originalXHRSend;
        }

        window[`${PLUGIN_ID}_instance`] = this;
    }

    uninstallNetworkInterceptors() {
        if (this.originalFetch) {
            window.fetch = this.originalFetch;
            this.originalFetch = null;
        }

        const proto = window.XMLHttpRequest?.prototype;
        if (proto && this.originalXHROpen) {
            proto.open = this.originalXHROpen;
            this.originalXHROpen = null;
        }
        if (proto && this.originalXHRSend) {
            proto.send = this.originalXHRSend;
            this.originalXHRSend = null;
        }

        delete window[`${PLUGIN_ID}_instance`];
    }

    async inspectNetworkResponse(source, input, response) {
        const url = typeof input === "string" ? input : input?.url || response?.url || "";
        if (!this.shouldInspectUrl(url)) return;
        if (!response?.ok) return;

        const contentLength = Number(response.headers?.get?.("content-length") || 0);
        if (contentLength && contentLength > 5 * 1024 * 1024) return;

        const clone = response.clone();
        const buffer = await clone.arrayBuffer();
        await this.handleCapturedPayload(source, url, buffer);
    }

    async inspectXhrResponse(xhr) {
        const url = xhr.__betterGifsUrl || xhr.responseURL || "";
        if (!this.shouldInspectUrl(url)) return;
        if (xhr.status < 200 || xhr.status >= 300) return;

        let buffer = null;
        if (xhr.response instanceof ArrayBuffer) {
            buffer = xhr.response;
        } else if (typeof xhr.response === "string") {
            buffer = new TextEncoder().encode(xhr.response).buffer;
        } else {
            try {
                if (typeof xhr.responseText === "string") {
                    buffer = new TextEncoder().encode(xhr.responseText).buffer;
                }
            } catch {}
        }

        if (!buffer || buffer.byteLength > 5 * 1024 * 1024) return;
        await this.handleCapturedPayload("xhr", url, buffer);
    }

    shouldInspectUrl(url) {
        try {
            const parsed = new URL(url, window.location.origin);
            const host = parsed.hostname.toLowerCase();
            if (!/discord|discordapp/i.test(host)) return false;
            return SETTINGS_PROTO_RE.test(`${parsed.pathname}${parsed.search}`);
        } catch {
            return false;
        }
    }

    async handleCapturedPayload(source, url, buffer) {
        if (!buffer?.byteLength) return;

        const utf8 = new TextDecoder().decode(buffer);
        const binary = new TextDecoder("latin1").decode(buffer);
        const payloadVariants = [...new Set([utf8, binary].filter(Boolean))];
        const added = this.addUrls(this.extractUrls(payloadVariants));
        const payloadText = utf8.length >= binary.length ? utf8 : binary;

        this.captureState = {
            lastUrl: url,
            lastSource: source,
            lastAdded: added,
            lastSize: buffer.byteLength,
            lastCaptureAt: Date.now(),
            lastPayloadText: payloadText,
            lastPayloadVariants: payloadVariants
        };

        if (added > 0) {
            this.notice(`Captured ${added} new URL${added === 1 ? "" : "s"} from /settings-proto/2`, "success");
        }

        this.refreshPanels();
    }

    refreshPanels(message = "") {
        for (const refresh of this.panelRefreshers) {
            try {
                refresh(message);
            } catch (error) {
                this.logError("Panel refresh failed", error);
            }
        }
    }

    formatCaptureStatus() {
        if (!this.captureState.lastCaptureAt) {
            return "Open the GIF Favourites tab and the plugin will scan its visible items. /settings-proto/2 capture is optional fallback.";
        }

        const when = new Date(this.captureState.lastCaptureAt).toLocaleString();
        if (this.captureState.lastSource.startsWith("favourites-dom")) {
            const prefix = this.favoriteCrawlRunning ? "Full favourites scan running. " : "";
            return `${prefix}Last favourites scan: ${when}, saw ${this.captureState.lastTotalSeen} visible item${this.captureState.lastTotalSeen === 1 ? "" : "s"}, added ${this.captureState.lastAdded} new URL${this.captureState.lastAdded === 1 ? "" : "s"}.`;
        }
        const sizeKb = (this.captureState.lastSize / 1024).toFixed(1);
        return `Last /settings-proto/2 capture: ${when}, ${sizeKb} KB, ${this.captureState.lastAdded} new URL${this.captureState.lastAdded === 1 ? "" : "s"}.`;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    saveRawCapture() {
        const payload = this.captureState.lastPayloadText;
        if (!payload) {
            this.notice("No /settings-proto/2 payload available", "warning");
            return;
        }

        const filename = `InfiniteGifs_Capture_${new Date(this.captureState.lastCaptureAt || Date.now()).toISOString().replace(/[:.]/g, "-")}.txt`;
        const variants = this.captureState.lastPayloadVariants?.filter(Boolean) || [];
        const text = variants.length > 1
            ? variants.map((variant, index) => `===== Variant ${index + 1} =====\n${variant}`).join("\n\n")
            : payload;
        this.saveBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), filename);
        this.notice("Saved last /settings-proto/2 payload", "success");
    }

    async processCapturedPayload() {
        const variants = this.captureState.lastPayloadVariants?.filter(Boolean) || [];
        if (!variants.length) {
            return this.processInput(this.captureState.lastPayloadText || "");
        }

        const textCandidates = [];
        for (const variant of variants) {
            const normalizedVariant = this.unwrapSettingsEnvelope(variant);
            textCandidates.push(normalizedVariant);
            textCandidates.push(...this.decodeBase64Variants(normalizedVariant));
        }

        const before = this.mediaUrls.length;
        this.addUrls(this.extractUrls(textCandidates));
        const added = this.mediaUrls.length - before;
        if (added) this.notice(`Added ${added} new media URL${added === 1 ? "" : "s"}`, "success");
        return added;
    }

    async processInput(input) {
        if (!input?.trim()) {
            this.notice("No input to process", "warning");
            return 0;
        }

        const normalizedInput = this.unwrapSettingsEnvelope(input);
        const before = this.mediaUrls.length;
        const textCandidates = [normalizedInput];
        textCandidates.push(...this.decodeBase64Variants(normalizedInput));
        this.addUrls(this.extractUrls(textCandidates));
        const added = this.mediaUrls.length - before;
        if (added) this.notice(`Added ${added} new media URL${added === 1 ? "" : "s"}`, "success");
        return added;
    }

    unwrapSettingsEnvelope(input) {
        const trimmed = input?.trim();
        if (!trimmed) return input;

        const withoutPrefix = trimmed.replace(/^:\s*(?=\{)/, "");
        if (!withoutPrefix.startsWith("{")) return input;

        try {
            const parsed = JSON.parse(withoutPrefix);
            if (typeof parsed?.settings === "string" && parsed.settings.trim()) {
                return parsed.settings.trim();
            }
        } catch {}

        return withoutPrefix;
    }

    decodeBase64Variants(input) {
        const clean = input.replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
        if (!clean || clean.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(clean)) return [];

        try {
            const binary = atob(clean);
            const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
            const utf8 = new TextDecoder().decode(bytes);
            return utf8 === binary ? [binary] : [binary, utf8];
        } catch {
            return [];
        }
    }

    extractUrls(chunks) {
        const found = new Set();
        for (const chunk of chunks) {
            for (const variant of this.expandTextVariants(chunk)) {
                const matches = variant.match(MEDIA_URL_RE) || [];
                for (const match of matches) {
                    const url = match.replace(/[)\]}>,]+$/, "");
                    if (this.isMediaUrl(url)) {
                        found.add(this.normalizeUrl(url));
                    }
                }
            }
        }
        return [...found];
    }

    expandTextVariants(text) {
        const variants = new Set();
        if (!text) return variants;

        variants.add(text);

        const slashDecoded = text
            .replace(/\\u002f/gi, "/")
            .replace(/\\\//g, "/");
        variants.add(slashDecoded);

        const commonUnicodeDecoded = slashDecoded.replace(/\\u00([0-9a-f]{2})/gi, (_, hex) => {
            const code = Number.parseInt(hex, 16);
            return Number.isNaN(code) ? _ : String.fromCharCode(code);
        });
        variants.add(commonUnicodeDecoded);

        return [...variants].filter(Boolean);
    }

    extractMediaFromMessage(message) {
        const urls = [];

        for (const attachment of message.attachments || []) {
            if (attachment?.url) urls.push(attachment.url);
        }
        for (const embed of message.embeds || []) {
            if (embed?.image?.url) urls.push(embed.image.url);
            if (embed?.video?.url) urls.push(embed.video.url);
            if (embed?.thumbnail?.url) urls.push(embed.thumbnail.url);
            if (embed?.gifv?.url) urls.push(embed.gifv.url);
        }
        if (message.content) {
            urls.push(...(message.content.match(MEDIA_URL_RE) || []));
        }

        return [...new Set(urls.filter(url => this.isMediaUrl(url)).map(url => this.normalizeUrl(url)))];
    }

    addUrls(urls) {
        const merged = new Set(this.mediaUrls);
        for (const url of urls) {
            const resolved = this.resolvePreferredMediaUrl(url) || url;
            if (this.isMediaUrl(resolved)) merged.add(this.normalizeUrl(resolved));
        }
        const before = this.mediaUrls.length;
        this.mediaUrls = [...merged];
        this.saveMediaUrls();
        return this.mediaUrls.length - before;
    }

    isMediaUrl(url) {
        try {
            const resolved = this.resolvePreferredMediaUrl(url) || url;
            const parsed = new URL(resolved);
            if (parsed.protocol !== "https:") return false;
            if (DISCORD_MEDIA_RE.test(parsed.hostname)) return true;
            if (/^(media\.tenor\.com|media\d*\.giphy\.com|i\.giphy\.com|gif\.fxtwitter\.com)$/i.test(parsed.hostname)) return true;
            if (KNOWN_MEDIA_HOST_RE.test(parsed.hostname) && MEDIA_EXT_RE.test(`${parsed.pathname}${parsed.search}`)) return true;
            return MEDIA_EXT_RE.test(`${parsed.pathname}${parsed.search}`);
        } catch {
            return false;
        }
    }

    normalizeUrl(url) {
        return this.basicNormalizeUrl(this.resolvePreferredMediaUrl(url) || url) || url;
    }

    getCounts() {
        const counts = { total: this.mediaUrls.length, gif: 0, mp4: 0, webm: 0 };
        for (const url of this.mediaUrls) {
            const ext = this.getExtension(url);
            if (ext in counts) counts[ext] += 1;
        }
        return counts;
    }

    getExtension(url) {
        try {
            const match = new URL(url).pathname.toLowerCase().match(/\.([a-z0-9]+)$/);
            if (!match) return "gif";
            return match[1] === "jpeg" ? "jpg" : match[1];
        } catch {
            return "gif";
        }
    }

    async downloadUrlsAsZip(urls = this.mediaUrls, onProgress = () => {}) {
        if (!urls.length) {
            this.notice("No media URLs to download", "warning");
            return;
        }

        try {
            await this.ensureJsZip();
        } catch (error) {
            this.logError("Failed to load JSZip", error);
            this.notice("Could not load JSZip", "error");
            return;
        }

        const zip = new window.JSZip();
        let added = 0;
        let failed = 0;
        this.abortController?.abort();
        this.abortController = new AbortController();

        for (const [index, url] of urls.entries()) {
            onProgress(`Downloading ${index + 1}/${urls.length}`);
            try {
                const response = await fetch(url, {
                    signal: this.abortController.signal,
                    credentials: "omit",
                    cache: "no-store"
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const blob = await response.blob();
                zip.file(this.makeFilename(url, index), blob);
                added += 1;
            } catch (error) {
                failed += 1;
                this.logError(`Failed to fetch ${url}`, error);
            }
        }

        if (!added) {
            onProgress("Nothing could be downloaded");
            this.notice("No files were downloaded", "error");
            return;
        }

        onProgress("Building ZIP...");
        const blob = await zip.generateAsync({ type: "blob" });
        this.saveBlob(blob, `InfiniteGifs_${new Date().toISOString().replace(/[:.]/g, "-")}.zip`);
        onProgress(`ZIP ready: ${added} file${added === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}`);
        this.notice(`ZIP downloaded (${added} ok${failed ? `, ${failed} failed` : ""})`, failed ? "warning" : "success");
    }

    async ensureJsZip() {
        if (window.JSZip) return;
        await new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${JSZIP_URL}"]`);
            if (existing) {
                if (window.JSZip) {
                    resolve();
                    return;
                }
                existing.addEventListener("load", resolve, { once: true });
                existing.addEventListener("error", reject, { once: true });
                return;
            }

            const script = document.createElement("script");
            script.src = JSZIP_URL;
            script.async = true;
            script.crossOrigin = "anonymous";
            script.addEventListener("load", resolve, { once: true });
            script.addEventListener("error", () => reject(new Error("Failed to load JSZip")), { once: true });
            document.head.appendChild(script);
        });
    }

    exportUrlList() {
        if (!this.mediaUrls.length) {
            this.notice("No media URLs to export", "warning");
            return;
        }

        const content = this.mediaUrls.join("\n");
        const filename = `InfiniteGifs_URLs_${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
        this.saveBlob(new Blob([content], { type: "text/plain;charset=utf-8" }), filename);
        this.notice(`Exported ${this.mediaUrls.length} URL${this.mediaUrls.length === 1 ? "" : "s"}`, "success");
    }

    saveBlob(blob, filename) {
        const href = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = href;
        link.download = filename;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
    }

    makeFilename(url, index) {
        const ext = this.getExtension(url);
        try {
            const parsed = new URL(url);
            const base = (parsed.pathname.split("/").pop() || "media")
                .replace(/\.[a-z0-9]+$/i, "")
                .replace(/[^a-z0-9_-]/gi, "")
                .slice(0, 32) || "media";
            return `${String(index + 1).padStart(4, "0")}_${base}.${ext}`;
        } catch {
            return `${String(index + 1).padStart(4, "0")}_media.${ext}`;
        }
    }

    notice(message, type = "info") {
        try {
            if (BdApi.UI?.showToast) BdApi.UI.showToast(message, { type });
            else if (BdApi.showToast) BdApi.showToast(message, { type });
            else if (BdApi.showNotice) BdApi.showNotice(message, { type, timeout: 5000 });
        } catch {
            this.log(message);
        }
    }

    log(message) {
        console.log(`[InfiniteGifs] ${message}`);
    }

    logError(message, error) {
        console.error(`[InfiniteGifs] ${message}`, error);
    }
};
