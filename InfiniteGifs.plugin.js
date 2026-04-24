/**
 * @name InfiniteGifs
 * @author VWilk
 * @authorId 363358047784927234
 * @version 1.3.0
 * @description A professional BetterDiscord plugin for fetching and managing GIFs from various sources
 * @source https://github.com/VWilk/InfiniteGifsBD
 * @updateUrl https://raw.githubusercontent.com/VWilk/InfiniteGifsBD/main/InfiniteGifs.plugin.js
 */

const CONFIG = {
    info: {
        name: "InfiniteGifs",
        authors: [{
            name: "VWilk",
            discord_id: "363358047784927234"
        }],
        version: "1.3.0",
        description: "A professional BetterDiscord plugin for fetching and managing GIFs from various sources",
        github: "https://github.com/VWilk/InfiniteGifsBD",
    },
    changelog: [
        {
            title: "Version 1.3.0",
            type: "improved",
            items: [
                "Added visual progress modal for downloads",
                "Implemented smart retry mechanism with exponential backoff",
                "Improved error handling and recovery",
                "Optimized batch processing for better performance",
                "Enhanced filename generation",
                "Added rate limit detection and smart delays",
                "Fixed settings panel functionality",
                "Improved memory management"
            ]
        }
    ],
    defaultConfig: [
        {
            type: "category",
            id: "dataSource",
            name: "Data Source Configuration",
            collapsible: true,
            shown: true,
            settings: [
                {
                    type: "text",
                    id: "base64Data",
                    name: "Base64 Encoded Data",
                    note: "Upload or paste your base64 encoded GIF data here",
                    value: ""
                }
            ]
        },
        {
            type: "category",
            id: "downloadSettings",
            name: "Download Settings",
            collapsible: true,
            shown: false,
            settings: [
                {
                    type: "switch",
                    id: "enableBatchDownload",
                    name: "Enable Batch Downloads",
                    note: "Allow downloading multiple files simultaneously",
                    value: true
                },
                {
                    type: "text",
                    id: "batchSize",
                    name: "Batch Size",
                    note: "Number of files to download simultaneously (1-10)",
                    value: "3"
                },
                {
                    type: "text",
                    id: "downloadDelay",
                    name: "Download Delay (ms)",
                    note: "Delay between downloads to avoid rate limiting",
                    value: "1000"
                }
            ]
        }
    ]
};

class InfiniteGifs {
    constructor() {
        this.settings = this.loadSettings();
        this.mediaUrls = [];
        this.downloadState = {
            isActive: false,
            current: 0,
            total: 0,
            successful: 0,
            failed: 0,
            cancelled: false
        };
        this.fileSaverLoaded = false;
        this.jsZipLoaded = false;
        this.tempBase64Data = null;
        this.requestQueue = [];
        this.maxConcurrentRequests = 3;
        this.activeRequests = 0;
        this.maxBase64Size = 100 * 1024 * 1024; // 100MB
        this.progressModal = null;
        this.statsContainer = null;
        this.statsGrid = null;
    }

    // ### Lifecycle Methods

    async start() {
        this.log("Plugin started");
        await this.loadMediaUrls();
        await this.decodeBase64Data();
    }

    stop() {
        this.log("Plugin stopped");
        this.cancelDownload();
        this.cleanup();
    }

    cleanup() {
        this.requestQueue = [];
        this.activeRequests = 0;
        this.tempBase64Data = null;
        if (this.progressModal) {
            this.progressModal.remove();
            this.progressModal = null;
        }
    }

    // ### Settings Management

    loadSettings() {
        try {
            const saved = BdApi.Data.load("InfiniteGifs", "settings");
            return saved || this.deepClone(CONFIG.defaultConfig);
        } catch (error) {
            this.logError("Failed to load settings", error);
            return this.deepClone(CONFIG.defaultConfig);
        }
    }

    saveSettings() {
        try {
            BdApi.Data.save("InfiniteGifs", "settings", this.settings);
        } catch (error) {
            this.logError("Failed to save settings", error);
        }
    }

    findSetting(id) {
        for (const category of this.settings) {
            const setting = category.settings.find(s => s.id === id);
            if (setting) return setting;
        }
        return null;
    }

    getSettingValue(id) {
        const setting = this.findSetting(id);
        return setting?.value || null;
    }

    // ### Media URL Management

    async loadMediaUrls() {
        try {
            const urls = BdApi.Data.load("InfiniteGifs", "media_urls");
            if (Array.isArray(urls)) {
                this.mediaUrls = urls.filter(url => this.isValidUrl(url));
                this.log(`Loaded ${this.mediaUrls.length} valid URLs from storage`);
            }
        } catch (error) {
            this.logError("Failed to load URLs from storage", error);
        }
    }

    async saveMediaUrls() {
        try {
            BdApi.Data.save("InfiniteGifs", "media_urls", this.mediaUrls);
            this.log(`Saved ${this.mediaUrls.length} URLs to storage`);
        } catch (error) {
            this.logError("Failed to save URLs to storage", error);
        }
    }

    getRandomMediaUrl() {
        if (this.mediaUrls.length === 0) {
            return null;
        }
        const randomIndex = Math.floor(Math.random() * this.mediaUrls.length);
        return this.mediaUrls[randomIndex];
    }

    isValidUrl(url) {
        try {
            const urlObj = new URL(url);
            if (urlObj.protocol !== 'https:') {
                return false;
            }
            const knownMediaDomains = ['cdn.discordapp.com', 'media.discordapp.net', 'tenor.com', 'giphy.com'];
            if (knownMediaDomains.some(domain => urlObj.hostname.includes(domain))) {
                return true;
            }
            const validExtensions = /\.(gif|mp4|webm|webp|jpg|jpeg|png)(\?.*)?$/i;
            const hasValidExtension = validExtensions.test(urlObj.pathname) || 
                                     validExtensions.test(urlObj.pathname + urlObj.search);
            if (!hasValidExtension) {
                return false;
            }
            const hostname = urlObj.hostname;
            if (!hostname || hostname.length < 3 || !hostname.includes('.')) {
                return false;
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    // ### Data Processing

    async decodeBase64Data() {
        const base64Setting = this.findSetting("base64Data");
        if (!base64Setting?.value && !this.tempBase64Data) {
            this.log("No base64 data to decode");
            return;
        }
        
        const dataToProcess = this.tempBase64Data || base64Setting.value;
        
        try {
            this.showMessage("Processing base64 data...", "info");
            const decodedData = await this.processBase64InChunks(dataToProcess);
            await this.extractUrlsFromData(decodedData);
            this.log("Base64 data decoded successfully");
            this.showMessage(`Processed successfully! Found ${this.mediaUrls.length} URLs`, "success");
            this.updateStats();
        } catch (error) {
            this.logError("Failed to decode base64 data", error);
            this.showMessage("Failed to decode base64 data", "error");
        }
    }

    async processBase64InChunks(base64Data) {
        if (base64Data.length > this.maxBase64Size) {
            throw new Error("Base64 data exceeds 100MB limit");
        }
        try {
            const cleanedData = base64Data.replace(/[^A-Za-z0-9+/=]/g, '');
            const paddingNeeded = (4 - (cleanedData.length % 4)) % 4;
            const paddedData = cleanedData + '='.repeat(paddingNeeded);
            const decoded = atob(paddedData);
            return decoded;
        } catch (error) {
            this.logError("Failed to decode base64 data", error);
            throw new Error("Invalid base64 data");
        }
    }

    async extractUrlsFromData(data) {
        const patterns = [
            /https:\/\/[^\s\x00-\x1F<>"'`{}|\\^]*\.(?:gif|mp4|webm|webp|jpg|jpeg|png)(?:\?[^\s\x00-\x1F<>"'`{}|\\^]*)?/gi,
            /https:\/\/cdn\.discordapp\.com\/attachments\/[^\s<>"'`{}|\\^]*\.(?:gif|mp4|webm|webp|jpg|jpeg|png)/gi,
            /https:\/\/media\.discordapp\.net\/attachments\/[^\s<>"'`{}|\\^]*\.(?:gif|mp4|webm|webp|jpg|jpeg|png)/gi,
            /https:\/\/tenor\.com\/view\/[^\s<>"'`{}|\\^]*/gi,
            /https:\/\/giphy\.com\/gifs\/[^\s<>"'`{}|\\^]*/gi
        ];
        
        const allMatches = new Set();
        for (const pattern of patterns) {
            const matches = data.match(pattern) || [];
            matches.forEach(match => allMatches.add(match));
        }
        const urls = Array.from(allMatches);
        const validUrls = urls.filter(url => this.isValidUrl(url));
        const newUrls = [...this.mediaUrls, ...validUrls];
        this.mediaUrls = await this.removeDuplicateUrls(newUrls);
        await this.saveMediaUrls();
        this.log(`Extracted ${validUrls.length} valid URLs, total unique: ${this.mediaUrls.length}`);
    }

    async removeDuplicateUrls(urls) {
        const uniqueUrls = new Set();
        const result = [];
        for (const url of urls) {
            if (!this.isValidUrl(url)) continue;
            const normalizedUrl = this.normalizeUrl(url);
            if (!uniqueUrls.has(normalizedUrl)) {
                uniqueUrls.add(normalizedUrl);
                result.push(url);
            }
        }
        const duplicatesRemoved = urls.length - result.length;
        if (duplicatesRemoved > 0) {
            this.log(`Removed ${duplicatesRemoved} duplicate/invalid URLs`);
        }
        return result;
    }

    normalizeUrl(url) {
        try {
            const urlObj = new URL(url);
            const paramsToRemove = ['ex', 'is', 'hm', 'width', 'height', 't', 'timestamp'];
            paramsToRemove.forEach(param => urlObj.searchParams.delete(param));
            const sortedParams = new URLSearchParams([...urlObj.searchParams].sort());
            urlObj.search = sortedParams.toString();
            return urlObj.toString();
        } catch (error) {
            return url;
        }
    }

    // ### Dependency Loading

    async loadScript(src) {
        return new Promise((resolve, reject) => {
            const existingScript = document.querySelector(`script[src="${src}"]`);
            if (existingScript) {
                setTimeout(() => {
                    if (this.verifyLibraryLoaded(src)) {
                        resolve();
                    } else {
                        existingScript.remove();
                        this.loadScriptInternal(src, resolve, reject);
                    }
                }, 100);
                return;
            }
            this.loadScriptInternal(src, resolve, reject);
        });
    }

    loadScriptInternal(src, resolve, reject) {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.crossOrigin = 'anonymous';
        
        const timeout = setTimeout(() => {
            script.remove();
            reject(new Error(`Script load timeout: ${src}`));
        }, 10000);
        
        script.onload = () => {
            clearTimeout(timeout);
            this.log(`Successfully loaded script: ${src}`);
            setTimeout(() => resolve(), 100);
        };
        
        script.onerror = (error) => {
            clearTimeout(timeout);
            script.remove();
            this.logError(`Failed to load script: ${src}`, error);
            reject(new Error(`Failed to load: ${src}`));
        };
        
        document.head.appendChild(script);
    }

    verifyLibraryLoaded(src) {
        if (src.includes('jszip')) return !!window.JSZip;
        if (src.includes('FileSaver')) return !!window.saveAs;
        return true;
    }

    async initializeFileSaver() {
        if (this.fileSaverLoaded && window.saveAs) return true;
        
        try {
            await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js');
            await this.delay(100);
            
            if (window.saveAs) {
                this.fileSaverLoaded = true;
                this.log("FileSaver.js loaded successfully");
                return true;
            }
            throw new Error("FileSaver.js not available after loading");
        } catch (error) {
            this.logError("Failed to load FileSaver.js, using fallback", error);
            this.implementFallbackSaveAs();
            this.fileSaverLoaded = true;
            return true;
        }
    }

    implementFallbackSaveAs() {
        if (!window.saveAs) {
            window.saveAs = (blob, filename) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            };
        }
    }

    async initializeJSZip() {
        if (this.jsZipLoaded && window.JSZip) return true;
        
        const cdnUrls = [
            'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
            'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
            'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js'
        ];
        
        for (const url of cdnUrls) {
            try {
                await this.loadScript(url);
                await this.delay(100);
                if (window.JSZip) {
                    this.jsZipLoaded = true;
                    this.log(`JSZip loaded from: ${url}`);
                    return true;
                }
            } catch (error) {
                this.log(`Failed to load JSZip from ${url}: ${error.message}`);
            }
        }
        
        throw new Error('Unable to load JSZip library from any CDN');
    }

    // ### Download Functionality

    async downloadAllMedia(method = 'zip') {
        if (this.downloadState.isActive) {
            this.showMessage("Download already in progress", "warning");
            return;
        }
        if (this.mediaUrls.length === 0) {
            this.showMessage("No media files to download", "error");
            return;
        }
        
        this.resetDownloadState();
        this.downloadState.isActive = true;
        this.downloadState.total = this.mediaUrls.length;
        
        try {
            if (method === 'zip') {
                await this.downloadAsZip();
            } else {
                await this.downloadIndividually();
            }
        } catch (error) {
            this.logError("Download failed", error);
            this.showMessage(`Download failed: ${error.message}`, "error");
        } finally {
            this.downloadState.isActive = false;
            if (this.progressModal) {
                this.progressModal.remove();
                this.progressModal = null;
            }
        }
    }

    async downloadAsZip() {
        try {
            // Initialize libraries with race condition protection
            const initPromises = [
                Promise.race([this.initializeJSZip(), new Promise((_, reject) => setTimeout(() => reject(new Error('JSZip load timeout')), 10000))]),
                Promise.race([this.initializeFileSaver(), new Promise((_, reject) => setTimeout(() => reject(new Error('FileSaver load timeout')), 10000))])
            ];
            
            const [jsZipReady, fileSaverReady] = await Promise.allSettled(initPromises);
            
            if (jsZipReady.status !== 'fulfilled' || !jsZipReady.value) {
                throw new Error('JSZip failed to load');
            }
            
            if (fileSaverReady.status !== 'fulfilled' || !fileSaverReady.value) {
                this.log('FileSaver failed to load, using fallback');
            }
            
            const zip = new JSZip();
            const batchSize = Math.min(parseInt(this.getSettingValue("batchSize")) || 3, 5);
            
            // Create progress modal
            this.progressModal = this.createProgressModal();
            document.body.appendChild(this.progressModal);
            
            this.showMessage(`Creating ZIP archive... (${this.mediaUrls.length} files)`, "info");
            
            // Process URLs in batches
            for (let i = 0; i < this.mediaUrls.length; i += batchSize) {
                if (this.downloadState.cancelled) {
                    this.showMessage("Download cancelled", "warning");
                    return;
                }
                
                const batch = this.mediaUrls.slice(i, i + batchSize);
                const progress = Math.round((i / this.mediaUrls.length) * 100);
                this.showMessage(`Processing batch ${Math.floor(i/batchSize) + 1}... (${progress}%)`, "info");
                
                await this.processBatch(batch, zip, i);
                this.updateProgressModal();
                this.updateDownloadProgress();
                
                // Smart delay between batches
                if (i + batchSize < this.mediaUrls.length) {
                    await this.smartDelay();
                }
            }
            
            if (!this.downloadState.cancelled) {
                // Generate and download ZIP
                this.progressModal.querySelector('.progress-text').textContent = 'Creating ZIP file...';
                this.showMessage("Generating ZIP file... This may take a moment.", "info");
                
                const content = await zip.generateAsync({
                    type: "blob",
                    compression: "DEFLATE",
                    compressionOptions: { level: 6 },
                    streamFiles: true,
                    onUpdate: (metadata) => {
                        if (this.progressModal) {
                            const percent = metadata.percent.toFixed(0);
                            this.progressModal.querySelector('.progress-bar-fill').style.width = `${percent}%`;
                            this.progressModal.querySelector('.progress-text').textContent = 
                                `Creating ZIP file... ${percent}%`;
                        }
                    }
                });
                
                const filename = this.generateZipFilename();
                if (window.saveAs) {
                    window.saveAs(content, filename);
                    this.showMessage(`ZIP created: ${filename} (${this.downloadState.successful} files)`, "success");
                } else {
                    this.downloadBlob(content, filename);
                    this.showMessage(`ZIP created using fallback: ${filename}`, "success");
                }
            }
            
        } catch (error) {
            this.logError("ZIP creation failed", error);
            this.showMessage(`ZIP creation failed: ${error.message}`, "error");
            await this.exportUrlList();
        }
    }

    async processBatch(urls, zip, startIndex, retries = 3) {
        const promises = urls.map(async (url, index) => {
            const globalIndex = startIndex + index;
            const filename = this.generateOptimizedFilename(url, globalIndex);
            
            for (let attempt = 0; attempt < retries; attempt++) {
                try {
                    const response = await this.fetchWithTimeout(url, 30000);
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    
                    const blob = await response.blob();
                    
                    // Validate blob
                    if (blob.size === 0) throw new Error('Empty file');
                    if (blob.size > 50 * 1024 * 1024) throw new Error('File too large (>50MB)');
                    
                    const arrayBuffer = await blob.arrayBuffer();
                    zip.file(filename, arrayBuffer, { compression: "STORE" });
                    
                    this.downloadState.successful++;
                    this.log(`Added to ZIP: ${filename}`);
                    return;
                    
                } catch (error) {
                    if (attempt === retries - 1) {
                        this.downloadState.failed++;
                        this.logError(`Failed to process ${url} after ${retries} attempts`, error);
                        zip.file(`ERROR_${filename}.txt`, 
                            `Failed to download: ${url}\nError: ${error.message}\nTime: ${new Date().toISOString()}`
                        );
                    } else {
                        this.log(`Retrying ${url} (attempt ${attempt + 2}/${retries})`);
                        await this.delay(Math.pow(2, attempt) * 1000);
                    }
                } finally {
                    this.downloadState.current++;
                }
            }
        });
        
        await Promise.allSettled(promises);
    }

    async downloadIndividually() {
        const fileSaverReady = await this.initializeFileSaver();
        if (!fileSaverReady) {
            this.showMessage("Download functionality not available - exporting URLs instead", "warning");
            await this.exportUrlList();
            return;
        }
        
        const delay = parseInt(this.getSettingValue("downloadDelay")) || 1000;
        const batchSize = parseInt(this.getSettingValue("batchSize")) || 3;
        
        this.showMessage("Starting individual downloads...", "info");
        
        for (let i = 0; i < this.mediaUrls.length; i += batchSize) {
            if (this.downloadState.cancelled) break;
            
            const batch = this.mediaUrls.slice(i, i + batchSize);
            const promises = batch.map(async (url, batchIndex) => {
                const globalIndex = i + batchIndex;
                const filename = this.generateOptimizedFilename(url, globalIndex);
                
                try {
                    const response = await this.fetchWithTimeout(url, 30000);
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    
                    const blob = await response.blob();
                    if (window.saveAs) {
                        window.saveAs(blob, filename);
                    } else {
                        this.downloadBlob(blob, filename);
                    }
                    
                    this.downloadState.successful++;
                    this.log(`Downloaded: ${filename}`);
                } catch (error) {
                    this.downloadState.failed++;
                    this.logError(`Failed to download ${filename}`, error);
                } finally {
                    this.downloadState.current++;
                }
            });
            
            await Promise.allSettled(promises);
            this.updateDownloadProgress();
            
            if (i + batchSize < this.mediaUrls.length) {
                await this.delay(delay);
            }
        }
        
        this.showMessage(
            `Downloads complete! ${this.downloadState.successful} successful, ${this.downloadState.failed} failed`,
            this.downloadState.successful > 0 ? "success" : "error"
        );
    }

    async smartDelay() {
        const baseDelay = parseInt(this.getSettingValue("downloadDelay")) || 1000;
        const failureRate = this.downloadState.failed / (this.downloadState.current || 1);
        
        // Increase delay if many failures (potential rate limiting)
        let adjustedDelay = baseDelay;
        if (failureRate > 0.3) {
            adjustedDelay = baseDelay * 2;
        } else if (failureRate > 0.5) {
            adjustedDelay = baseDelay * 3;
        }
        
        // Random jitter to avoid synchronized requests
        const jitter = Math.random() * 500;
        const totalDelay = Math.max(adjustedDelay + jitter, 500);
        
        this.log(`Smart delay: ${totalDelay.toFixed(0)}ms (failure rate: ${(failureRate * 100).toFixed(1)}%)`);
        await this.delay(totalDelay);
    }

    // ### Progress Modal

    createProgressModal() {
        const modal = document.createElement('div');
        modal.className = 'infinitegifs-progress-modal';
        modal.innerHTML = `
            <div class="progress-container">
                <h3>📥 Downloading Media Files</h3>
                <div class="progress-stats">
                    <span class="progress-current">0</span> / <span class="progress-total">0</span> files
                </div>
                <div class="progress-bar">
                    <div class="progress-bar-fill"></div>
                </div>
                <div class="progress-details">
                    <div>✅ Success: <span class="progress-success">0</span></div>
                    <div>❌ Failed: <span class="progress-failed">0</span></div>
                </div>
                <div class="progress-text">Preparing downloads...</div>
                <button class="cancel-btn">Cancel</button>
            </div>
        `;
        
        // Add styles if not already present
        if (!document.querySelector('#infinitegifs-modal-styles')) {
            const style = document.createElement('style');
            style.id = 'infinitegifs-modal-styles';
            style.textContent = `
                .infinitegifs-progress-modal {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: #36393f;
                    border-radius: 8px;
                    padding: 20px;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
                    z-index: 999999;
                    min-width: 400px;
                    color: #dcddde;
                    font-family: Whitney, "Helvetica Neue", Helvetica, Arial, sans-serif;
                }
                .progress-container h3 {
                    margin: 0 0 15px 0;
                    color: #fff;
                    font-size: 18px;
                    text-align: center;
                }
                .progress-stats {
                    text-align: center;
                    margin-bottom: 10px;
                    font-size: 14px;
                    font-weight: 500;
                }
                .progress-bar {
                    height: 24px;
                    background: #202225;
                    border-radius: 12px;
                    overflow: hidden;
                    margin-bottom: 15px;
                }
                .progress-bar-fill {
                    height: 100%;
                    background: linear-gradient(90deg, #5865f2, #7289da);
                    transition: width 0.3s ease;
                    width: 0%;
                }
                .progress-details {
                    display: flex;
                    justify-content: space-around;
                    margin-bottom: 10px;
                    font-size: 13px;
                }
                .progress-text {
                    text-align: center;
                    font-size: 12px;
                    color: #b9bbbe;
                    margin: 10px 0;
                }
                .cancel-btn {
                    width: 100%;
                    padding: 8px;
                    background: #f04747;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: 500;
                    transition: opacity 0.2s;
                }
                .cancel-btn:hover {
                    opacity: 0.8;
                }
            `;
            document.head.appendChild(style);
        }
        
        // Add cancel functionality
        modal.querySelector('.cancel-btn').addEventListener('click', () => {
            this.downloadState.cancelled = true;
            modal.remove();
        });
        
        // Set initial values
        modal.querySelector('.progress-total').textContent = this.mediaUrls.length;
        
        return modal;
    }

    updateProgressModal() {
        if (!this.progressModal) return;
        
        const progress = (this.downloadState.current / this.downloadState.total * 100).toFixed(0);
        
        this.progressModal.querySelector('.progress-current').textContent = this.downloadState.current;
        this.progressModal.querySelector('.progress-success').textContent = this.downloadState.successful;
        this.progressModal.querySelector('.progress-failed').textContent = this.downloadState.failed;
        this.progressModal.querySelector('.progress-bar-fill').style.width = `${progress}%`;
        this.progressModal.querySelector('.progress-text').textContent = 
            `Processing... ${progress}% complete`;
    }

    // ### Settings Panel

    getSettingsPanel() {
        const panel = document.createElement("div");
        panel.className = "infinite-gifs-settings";
        panel.style.cssText = `
            padding: 20px;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: #2f3136;
            color: #dcddde;
            border-radius: 8px;
            max-height: 600px;
            overflow-y: auto;
        `;
        this.generateSettingsCategories(panel);
        this.generateStatsSection(panel);
        return panel;
    }

    generateSettingsCategories(panel) {
        this.settings.forEach(category => {
            const categoryElement = this.createCategoryElement(category);
            panel.appendChild(categoryElement);
        });
    }

    createCategoryElement(category) {
        const container = document.createElement("div");
        container.className = "settings-category";
        container.style.cssText = `
            margin-bottom: 25px;
            padding: 15px;
            background: #36393f;
            border-radius: 8px;
            border: 1px solid #4f545c;
        `;
        const title = document.createElement("h2");
        title.textContent = category.name;
        title.style.cssText = `
            margin: 0 0 15px 0;
            color: #ffffff;
            font-size: 18px;
            font-weight: 600;
        `;
        container.appendChild(title);
        category.settings.forEach(setting => {
            const settingElement = this.createSettingElement(setting);
            container.appendChild(settingElement);
        });
        return container;
    }

    createSettingElement(setting) {
        const container = document.createElement("div");
        container.className = "setting-item";
        container.style.cssText = `
            margin-bottom: 20px;
            padding: 15px;
            background: #2f3136;
            border-radius: 6px;
            border: 1px solid #4f545c;
        `;
        const label = document.createElement("label");
        label.style.cssText = `
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #ffffff;
        `;
        label.textContent = setting.name;
        container.appendChild(label);
        if (setting.note) {
            const note = document.createElement("div");
            note.textContent = setting.note;
            note.style.cssText = `
                margin-bottom: 10px;
                font-size: 13px;
                color: #b9bbbe;
                font-style: italic;
            `;
            container.appendChild(note);
        }
        const inputElement = this.createInputElement(setting);
        if (inputElement) {
            container.appendChild(inputElement);
        }
        return container;
    }

    createInputElement(setting) {
        switch (setting.type) {
            case "text":
                return setting.id === "base64Data" 
                    ? this.createBase64Input(setting)
                    : this.createTextInput(setting);
            case "switch":
                return this.createSwitchInput(setting);
            default:
                return null;
        }
    }

    createBase64Input(setting) {
        const container = document.createElement("div");
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".txt,.json";
        fileInput.style.cssText = `
            margin-bottom: 10px;
            padding: 8px;
            background: #40444b;
            color: #dcddde;
            border: 1px solid #4f545c;
            border-radius: 4px;
            width: 100%;
        `;
        const statusContainer = document.createElement("div");
        statusContainer.style.cssText = `
            width: 100%;
            padding: 15px;
            background: #40444b;
            color: #dcddde;
            border: 1px solid #4f545c;
            border-radius: 4px;
            margin-bottom: 10px;
            min-height: 80px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
        `;
        const buttonContainer = document.createElement("div");
        buttonContainer.style.cssText = `
            display: flex;
            gap: 10px;
            margin-bottom: 10px;
            flex-wrap: wrap;
        `;
        const loadButton = this.createButton("Load from File", "#5865f2", () => fileInput.click());
        const processButton = this.createButton("Process Data", "#43b581", async () => {
            if (this.tempBase64Data) {
                this.updateBase64Status("🔄 Processing data...", "#faa61a", statusContainer);
                try {
                    setting.value = this.tempBase64Data;
                    this.saveSettings();
                    await this.decodeBase64Data();
                    this.updateBase64Status("✅ Data processed successfully", "#43b581", statusContainer);
                    this.updateStats();
                } catch (error) {
                    this.logError("Failed to process data", error);
                    this.updateBase64Status("❌ Processing failed", "#f04747", statusContainer);
                }
            } else {
                this.updateBase64Status("⚠️ No data to process", "#faa61a", statusContainer);
            }
        });
        const clearButton = this.createButton("Clear Data", "#f04747", () => {
            this.tempBase64Data = null;
            setting.value = "";
            this.saveSettings();
            this.mediaUrls = [];
            this.saveMediaUrls();
            this.updateBase64Status("🗑️ Data cleared", "#faa61a", statusContainer);
            this.updateStats();
        });
        const statusDiv = document.createElement("div");
        statusDiv.className = "base64-status";
        statusDiv.style.cssText = `
            font-size: 13px;
            font-weight: 500;
            margin-top: 10px;
        `;
        this.updateBase64Status = (message, color, container) => {
            statusDiv.textContent = message;
            statusDiv.style.color = color;
            if (this.tempBase64Data || setting.value) {
                const dataSize = this.tempBase64Data ? this.tempBase64Data.length : (setting.value ? setting.value.length : 0);
                const sizeKB = Math.round(dataSize / 1024);
                const sizeMB = (dataSize / (1024 * 1024)).toFixed(2);
                container.innerHTML = `
                    <div style="color: #43b581; font-weight: bold; margin-bottom: 8px;">📊 Data Information</div>
                    <div style="margin-bottom: 4px;">📏 Size: ${sizeKB.toLocaleString()} KB (${sizeMB} MB)</div>
                    <div style="margin-bottom: 4px;">🔢 Characters: ${dataSize.toLocaleString()}</div>
                    <div style="margin-bottom: 4px;">📸 URLs Found: ${this.mediaUrls.length.toLocaleString()}</div>
                    <div style="margin-bottom: 4px;">⚡ Status: ${this.tempBase64Data ? 'Loaded (ready to process)' : 'Processed'}</div>
                    <div style="color: #72767d; font-size: 11px; margin-top: 8px;">
                        ✨ Large data handled efficiently - UI stays responsive
                    </div>
                `;
            } else {
                container.innerHTML = `
                    <div style="color: #72767d; text-align: center; padding: 20px;">
                        📤 No data loaded yet<br>
                        <small>Select a file or paste base64 data to begin</small>
                    </div>
                `;
            }
        };
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                this.updateBase64Status("🔄 Loading file...", "#faa61a", statusContainer);
                try {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        this.tempBase64Data = event.target.result;
                        this.updateBase64Status("✅ File loaded successfully", "#43b581", statusContainer);
                    };
                    reader.onerror = () => {
                        this.updateBase64Status("❌ Failed to load file", "#f04747", statusContainer);
                    };
                    reader.readAsText(file);
                } catch (error) {
                    this.logError("Failed to read file", error);
                    this.updateBase64Status("❌ Failed to read file", "#f04747", statusContainer);
                }
            }
        });
        buttonContainer.appendChild(loadButton);
        buttonContainer.appendChild(processButton);
        buttonContainer.appendChild(clearButton);
        container.appendChild(fileInput);
        container.appendChild(statusContainer);
        container.appendChild(buttonContainer);
        container.appendChild(statusDiv);
        this.updateBase64Status("Ready", "#43b581", statusContainer);
        return container;
    }

    createTextInput(setting) {
        const input = document.createElement("input");
        input.type = "text";
        input.value = setting.value || "";
        input.style.cssText = `
            width: 100%;
            padding: 10px;
            background: #40444b;
            color: #dcddde;
            border: 1px solid #4f545c;
            border-radius: 4px;
            font-size: 14px;
        `;
        input.addEventListener('input', (e) => {
            setting.value = e.target.value;
            this.saveSettings();
        });
        return input;
    }

    createSwitchInput(setting) {
        const container = document.createElement("div");
        container.style.cssText = `
            display: flex;
            align-items: center;
            gap: 10px;
        `;
        const switchContainer = document.createElement("div");
        switchContainer.style.cssText = `
            position: relative;
            width: 44px;
            height: 24px;
            background: ${setting.value ? '#43b581' : '#72767d'};
            border-radius: 12px;
            cursor: pointer;
            transition: background 0.2s;
        `;
        const switchHandle = document.createElement("div");
        switchHandle.style.cssText = `
            position: absolute;
            top: 2px;
            left: ${setting.value ? '22px' : '2px'};
            width: 20px;
            height: 20px;
            background: white;
            border-radius: 50%;
            transition: left 0.2s;
        `;
        switchContainer.appendChild(switchHandle);
        const label = document.createElement("span");
        label.textContent = setting.value ? "Enabled" : "Disabled";
        label.style.cssText = `
            font-size: 14px;
            color: ${setting.value ? '#43b581' : '#72767d'};
            font-weight: 500;
        `;
        switchContainer.addEventListener('click', () => {
            setting.value = !setting.value;
            switchContainer.style.background = setting.value ? '#43b581' : '#72767d';
            switchHandle.style.left = setting.value ? '22px' : '2px';
            label.textContent = setting.value ? "Enabled" : "Disabled";
            label.style.color = setting.value ? '#43b581' : '#72767d';
            this.saveSettings();
        });
        container.appendChild(switchContainer);
        container.appendChild(label);
        return container;
    }

    createButton(text, color, onClick) {
        const button = document.createElement("button");
        button.textContent = text;
        button.style.cssText = `
            padding: 8px 16px;
            background: ${color};
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 500;
            font-size: 14px;
            transition: opacity 0.2s;
        `;
        button.addEventListener('mouseenter', () => button.style.opacity = '0.8');
        button.addEventListener('mouseleave', () => button.style.opacity = '1');
        button.addEventListener('click', onClick);
        return button;
    }

    generateStatsSection(panel) {
        const statsContainer = document.createElement("div");
        statsContainer.className = "stats-section";
        statsContainer.style.cssText = `
            margin-top: 20px;
            padding: 20px;
            background: #36393f;
            border-radius: 8px;
            border: 1px solid #4f545c;
        `;
        const title = document.createElement("h2");
        title.textContent = "Statistics & Actions";
        title.style.cssText = `
            margin: 0 0 15px 0;
            color: #ffffff;
            font-size: 18px;
            font-weight: 600;
        `;
        statsContainer.appendChild(title);
        const statsGrid = document.createElement("div");
        statsGrid.className = "stats-grid";
        statsGrid.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        `;
        this.createStatsCards(statsGrid);
        const actionsContainer = document.createElement("div");
        actionsContainer.style.cssText = `
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            margin-top: 15px;
        `;
        this.createActionButtons(actionsContainer);
        statsContainer.appendChild(statsGrid);
        statsContainer.appendChild(actionsContainer);
        panel.appendChild(statsContainer);
        this.statsContainer = statsContainer;
        this.statsGrid = statsGrid;
    }

    createStatsCards(container) {
        const stats = this.calculateStats();
        Object.entries(stats).forEach(([key, value]) => {
            const card = document.createElement("div");
            card.style.cssText = `
                padding: 15px;
                background: #2f3136;
                border-radius: 6px;
                border: 1px solid #4f545c;
                text-align: center;
            `;
            const valueDiv = document.createElement("div");
            valueDiv.textContent = value.toLocaleString();
            valueDiv.style.cssText = `
                font-size: 24px;
                font-weight: bold;
                color: #43b581;
                margin-bottom: 5px;
            `;
            const labelDiv = document.createElement("div");
            labelDiv.textContent = this.formatStatLabel(key);
            labelDiv.style.cssText = `
                font-size: 12px;
                color: #b9bbbe;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            `;
            card.appendChild(valueDiv);
            card.appendChild(labelDiv);
            container.appendChild(card);
        });
    }

    createActionButtons(container) {
        const buttons = [
            { text: "📥 Download as ZIP", color: "#5865f2", action: () => this.downloadAllMedia('zip') },
            { text: "📄 Export URL List", color: "#43b581", action: () => this.exportUrlList() },
            { text: "🔄 Refresh Stats", color: "#faa61a", action: () => this.updateStats() },
            { text: "❌ Cancel Download", color: "#f04747", action: () => this.cancelDownload() }
        ];
        buttons.forEach(({ text, color, action }) => {
            const button = this.createButton(text, color, action);
            container.appendChild(button);
        });
    }

    calculateStats() {
        const gifCount = this.mediaUrls.filter(url => url.includes('.gif')).length;
        const mp4Count = this.mediaUrls.filter(url => url.includes('.mp4')).length;
        const webmCount = this.mediaUrls.filter(url => url.includes('.webm')).length;
        return {
            total: this.mediaUrls.length,
            gif: gifCount,
            mp4: mp4Count,
            webm: webmCount,
            successful: this.downloadState.successful,
            failed: this.downloadState.failed
        };
    }

    formatStatLabel(key) {
        const labels = {
            total: "Total URLs",
            gif: "GIF Files",
            mp4: "MP4 Files",
            webm: "WEBM Files",
            successful: "Downloaded",
            failed: "Failed"
        };
        return labels[key] || key;
    }

    updateStats() {
        if (this.statsGrid) {
            this.statsGrid.innerHTML = '';
            this.createStatsCards(this.statsGrid);
        }
    }

    updateDownloadProgress() {
        if (this.downloadState.total > 0) {
            const progress = (this.downloadState.current / this.downloadState.total * 100).toFixed(1);
            this.log(`Download progress: ${progress}% (${this.downloadState.current}/${this.downloadState.total})`);
        }
    }

    // ### Utility Methods

    fetchWithTimeout(url, timeout = 30000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        return fetch(url, {
            signal: controller.signal,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/gif,image/webp,image/png,image/jpeg,video/mp4,video/webm,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            mode: 'cors',
            credentials: 'omit'
        }).finally(() => clearTimeout(timeoutId));
    }

    downloadBlob(blob, filename) {
        try {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
            this.logError("Failed to download blob", error);
            throw error;
        }
    }

    generateOptimizedFilename(url, index) {
        try {
            const urlObj = new URL(url);
            const ext = this.getFileExtension(url);
            const paddedIndex = String(index + 1).padStart(4, '0');
            
            // Extract meaningful part from URL
            let name = '';
            
            if (url.includes('tenor.com')) {
                name = 'tenor';
            } else if (url.includes('giphy.com')) {
                name = 'giphy';
            } else if (url.includes('discord')) {
                const match = urlObj.pathname.match(/\/([^\/]+)\.(gif|mp4|webm|png|jpg|jpeg|webp)/i);
                name = match ? match[1].substring(0, 20) : 'discord';
            } else {
                name = urlObj.hostname.split('.')[0].substring(0, 10);
            }
            
            // Clean filename
            name = name.replace(/[^a-zA-Z0-9-_]/g, '').substring(0, 20) || 'media';
            
            return `${paddedIndex}_${name}.${ext}`;
            
        } catch (error) {
            const ext = this.getFileExtension(url);
            const paddedIndex = String(index + 1).padStart(4, '0');
            return `${paddedIndex}_media.${ext}`;
        }
    }

    generateZipFilename() {
        const date = new Date().toISOString().slice(0, 10);
        const time = new Date().toISOString().slice(11, 19).replace(/:/g, '-');
        return `InfiniteGifs_${date}_${time}.zip`;
    }

    getFileExtension(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname.toLowerCase();
            const match = pathname.match(/\.([a-z0-9]+)$/);
            if (match) {
                const ext = match[1];
                // Map common extensions
                const extMap = {
                    'jpeg': 'jpg',
                    'webm': 'webm',
                    'mp4': 'mp4',
                    'webp': 'webp',
                    'gif': 'gif',
                    'png': 'png',
                    'jpg': 'jpg'
                };
                return extMap[ext] || ext;
            }
            
            // Fallback based on known domains
            if (url.includes('giphy.com') || url.includes('tenor.com')) {
                return 'gif';
            }
            
            return 'gif'; // Default fallback
        } catch (error) {
            return 'gif';
        }
    }

    resetDownloadState() {
        this.downloadState = {
            isActive: false,
            current: 0,
            total: 0,
            successful: 0,
            failed: 0,
            cancelled: false
        };
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    // ### Messaging and Logging

    showMessage(message, type = "info") {
        const colors = {
            info: "#5865f2",
            success: "#43b581",
            warning: "#faa61a",
            error: "#f04747"
        };
        const color = colors[type] || colors.info;
        BdApi.showNotice(message, { type, timeout: 5000 });
        this.log(`[${type.toUpperCase()}] ${message}`);
    }

    log(message) {
        console.log(`[InfiniteGifs] ${message}`);
    }

    logError(message, error) {
        console.error(`[InfiniteGifs] ${message}`, error);
    }

    // ### Context Menu Integration

    addContextMenuItems() {
        try {
            // Add context menu for messages with media
            BdApi.ContextMenu.patch("message", this.patchMessageContextMenu.bind(this));
            this.log("Context menu patched successfully");
        } catch (error) {
            this.logError("Failed to patch context menu", error);
        }
    }

    removeContextMenuItems() {
        try {
            BdApi.ContextMenu.unpatch("message", this.patchMessageContextMenu);
        } catch (error) {
            this.logError("Failed to unpatch context menu", error);
        }
    }

    patchMessageContextMenu(tree, props) {
        if (!props?.message) return tree;
        
        const message = props.message;
        const mediaUrls = this.extractMediaFromMessage(message);
        
        if (mediaUrls.length === 0) return tree;
        
        const menuItems = [
            BdApi.ContextMenu.buildItem({
                label: `Add ${mediaUrls.length} Media to Collection`,
                action: () => this.addUrlsToCollection(mediaUrls)
            }),
            BdApi.ContextMenu.buildItem({
                label: "Download This Media",
                action: () => this.downloadMediaUrls(mediaUrls)
            })
        ];
        
        tree.props.children.push(
            BdApi.ContextMenu.buildItem({
                label: "InfiniteGifs",
                children: menuItems
            })
        );
        
        return tree;
    }

    extractMediaFromMessage(message) {
        const urls = [];
        
        // Extract from attachments
        if (message.attachments) {
            message.attachments.forEach(attachment => {
                if (attachment.url && this.isValidUrl(attachment.url)) {
                    urls.push(attachment.url);
                }
            });
        }
        
        // Extract from embeds
        if (message.embeds) {
            message.embeds.forEach(embed => {
                if (embed.image?.url && this.isValidUrl(embed.image.url)) {
                    urls.push(embed.image.url);
                }
                if (embed.video?.url && this.isValidUrl(embed.video.url)) {
                    urls.push(embed.video.url);
                }
                if (embed.thumbnail?.url && this.isValidUrl(embed.thumbnail.url)) {
                    urls.push(embed.thumbnail.url);
                }
            });
        }
        
        // Extract from content
        if (message.content) {
            const urlRegex = /https:\/\/[^\s]+\.(?:gif|mp4|webm|webp|jpg|jpeg|png)(?:\?[^\s]*)?/gi;
            const matches = message.content.match(urlRegex) || [];
            matches.forEach(url => {
                if (this.isValidUrl(url)) {
                    urls.push(url);
                }
            });
        }
        
        return [...new Set(urls)]; // Remove duplicates
    }

    async addUrlsToCollection(urls) {
        const validUrls = urls.filter(url => this.isValidUrl(url));
        const initialCount = this.mediaUrls.length;
        
        this.mediaUrls = await this.removeDuplicateUrls([...this.mediaUrls, ...validUrls]);
        await this.saveMediaUrls();
        
        const addedCount = this.mediaUrls.length - initialCount;
        this.showMessage(`Added ${addedCount} new URLs to collection (Total: ${this.mediaUrls.length})`, "success");
    }

    async downloadMediaUrls(urls) {
        const tempUrls = this.mediaUrls;
        this.mediaUrls = urls.filter(url => this.isValidUrl(url));
        
        if (this.mediaUrls.length === 0) {
            this.showMessage("No valid media URLs found", "error");
            this.mediaUrls = tempUrls;
            return;
        }
        
        try {
            await this.downloadAllMedia('zip');
        } finally {
            this.mediaUrls = tempUrls;
        }
    }

    // ### Export URL List

    generateAdvancedUrlList() {
        const timestamp = new Date().toISOString();
        const stats = this.calculateStats();
        let content = `InfiniteGifs URL Export
Generated: ${timestamp}
Total URLs: ${this.mediaUrls.length}
GIF Files: ${stats.gif}
MP4 Files: ${stats.mp4}
WEBM Files: ${stats.webm}
Other Files: ${stats.total - stats.gif - stats.mp4 - stats.webm}

${'-'.repeat(50)}

URLs:
`;
        this.mediaUrls.forEach((url, index) => {
            const extension = this.getFileExtension(url);
            const paddedIndex = (index + 1).toString().padStart(4, '0');
            content += `${paddedIndex}. [${extension.toUpperCase()}] ${url}\n`;
        });
        content += `\n${'-'.repeat(50)}\nEnd of export - ${this.mediaUrls.length} URLs total\n`;
        return content;
    }

    async exportUrlList() {
        try {
            await this.initializeFileSaver();
            const content = this.generateAdvancedUrlList();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `InfiniteGifs_URLs_${timestamp}.txt`;
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            if (window.saveAs) {
                window.saveAs(blob, filename);
                this.showMessage(`Exported ${this.mediaUrls.length} URLs to ${filename}`, "success");
            } else {
                this.downloadBlob(blob, filename);
                this.showMessage(`Exported ${this.mediaUrls.length} URLs to ${filename}`, "success");
            }
        } catch (error) {
            this.logError("Failed to export URLs", error);
            try {
                const content = this.generateAdvancedUrlList();
                await navigator.clipboard.writeText(content);
                this.showMessage("URLs copied to clipboard (export failed)", "warning");
            } catch (clipboardError) {
                this.showMessage("Export failed and clipboard unavailable", "error");
            }
        }
    }

    cancelDownload() {
        if (this.downloadState.isActive) {
            this.downloadState.cancelled = true;
            this.showMessage("Download cancelled", "warning");
            this.log("Download cancelled by user");
        }
    }
}

// ### Plugin Export (Required by BetterDiscord)

module.exports = InfiniteGifs;