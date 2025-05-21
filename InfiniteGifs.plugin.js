/**
 * @name InfiniteGifs
 * @author VWilk
 * @authorId 363358047784927234
 * @version 1.0.1
 * @description A BetterDiscord plugin to fetch and display GIFs from a GitHub repository.
 * @source https://github.com/VWilk/InfiniteGifsBD
 */

const config = {
    info: {
        name: "InfiniteGifs",
        authors: [{
            name: "VWilk",
            discord_id: "363358047784927234"
        }],
        version: "1.0.1",
        description: "A BetterDiscord plugin to fetch and display GIFs from a GitHub repository.",
        github: "https://github.com/VWilk/InfiniteGifsBD",
    },
    
    changelog: [
        {
            title: "Version 1.0.0",
            type: "added",
            items: ["Initial release"]
        },
        {
            title: "Version 1.0.1",
            type: "fixed",
            items: ["Fixed clipboard permission issues by adding a direct text input option"]
        }
    ],
    defaultConfig: [
        {
            type: "category",
            id: "requiredSetup",
            name: "Plugin Key settings",
            collapsible: true,
            shown: true,
            settings: [
                {
                    type: "text",
                    id: "base64proto2",
                    name: "What you found in the {2} file:",
                    note: "",
                    value: "Put it in here!"
                }
            ]
        },
        {
            type: "category",
            id: "githubSetup",
            name: "Github Setup",
            collapsible: true,
            shown: false,
            settings: [
                {
                    type: "text",
                    id: "userGithubToken",
                    name: "Github API Token",
                    note: "Github API token here!",
                    value: ""
                },
                {
                    type: "text",
                    id: "userGithubRepositoryName",
                    name: "Github Repository Name",
                    note: "Format: username/repository",
                    value: "user/repo"
                },
                {
                    type: "switch",
                    id: "GithubOnOff",
                    name: "Enable GitHub Integration",
                    note: "Turn on or off GitHub functionality",
                    value: false
                }
            ]
        }
    ]
};

class InfiniteGifs {
    constructor() {
        this.settings = this.loadSettings();
        this.githubAdapter = null;
        this.urls = [];
        this.uniqueUrls = [];
    }

    loadSettings() {
        const saved = BdApi.Data.load("InfiniteGifs", "settings");
        return saved || JSON.parse(JSON.stringify(config.defaultConfig));
    }

    saveSettings() {
        BdApi.Data.save("InfiniteGifs", "settings", this.settings);
    }

    findSetting(id) {
        for (const category of this.settings) {
            const setting = category.settings.find(s => s.id === id);
            if (setting) return setting;
        }
        return null;
    }
    
    start() {
        console.log(`${config.info.name} plugin started`);
        this.decodeGifs();
        this.loadUrls();
    }
    
    stop() {
        console.log(`${config.info.name} plugin stopped`);
    }

    loadUrls() {
        try {
            const urls = BdApi.Data.load("InfiniteGifs", "media_urls");
            if (urls && Array.isArray(urls)) {
                this.uniqueUrls = urls;
                console.log(`Loaded ${this.uniqueUrls.length} URLs from storage`);
                return this.uniqueUrls;
            }
        } catch (error) {
            console.warn("Error loading URLs:", error);
        }
        
        this.uniqueUrls = [];
        return [];
    }
    
    getRandomGif() {
        if (this.uniqueUrls.length === 0) {
            this.loadUrls();
            if (this.uniqueUrls.length === 0) {
                console.warn("No GIFs available");
                return null;
            }
        }
        
        const randomIndex = Math.floor(Math.random() * this.uniqueUrls.length);
        return this.uniqueUrls[randomIndex];
    }

    getSettingsPanel() {
        const panel = document.createElement("div");
        panel.className = "bd-settings-panel";
        panel.style.padding = "20px";
        
        this.generateSettingsFromConfig(panel);
        this.addStatsSection(panel);
        
        return panel;
    }
    
    generateSettingsFromConfig(panel) {
        this.settings.forEach(category => {
            const categoryContainer = document.createElement("div");
            categoryContainer.className = "settings-category";
            categoryContainer.style.marginBottom = "20px";
            
            const categoryTitle = document.createElement("h2");
            categoryTitle.textContent = category.name;
            categoryTitle.style.marginBottom = "10px";
            categoryContainer.appendChild(categoryTitle);
            
            category.settings.forEach(setting => {
                const settingContainer = document.createElement("div");
                settingContainer.className = "settings-item";
                settingContainer.style.marginBottom = "15px";
                
                const settingName = document.createElement("h3");
                settingName.textContent = setting.name;
                settingName.style.fontSize = "16px";
                settingName.style.marginBottom = "5px";
                settingContainer.appendChild(settingName);
                
                if (setting.note) {
                    const settingNote = document.createElement("div");
                    settingNote.textContent = setting.note;
                    settingNote.style.fontSize = "12px";
                    settingNote.style.marginBottom = "5px";
                    settingNote.style.color = "#999";
                    settingContainer.appendChild(settingNote);
                }
                
                let inputElement;
                
                switch (setting.type) {
                    case "text":
                        if (setting.id === "base64proto2") {
                            const textAreaContainer = document.createElement("div");
                            textAreaContainer.style.width = "100%";
                            textAreaContainer.style.marginBottom = "10px";
                            
                            const hiddenTextarea = document.createElement("textarea");
                            hiddenTextarea.style.display = "none";
                            hiddenTextarea.value = setting.value || "";
                            textAreaContainer.appendChild(hiddenTextarea);
                            
                            const fileInput = document.createElement("input");
                            fileInput.type = "file";
                            fileInput.accept = ".txt";
                            fileInput.style.marginBottom = "10px";
                            textAreaContainer.appendChild(fileInput);
                            
                            const instruction = document.createElement("div");
                            instruction.textContent = "Upload a file containing your base64 data";
                            instruction.style.fontSize = "12px";
                            instruction.style.marginBottom = "5px";
                            instruction.style.color = "#999";
                            textAreaContainer.appendChild(instruction);
                            
                            const orText = document.createElement("div");
                            orText.textContent = "-- OR --";
                            orText.style.fontSize = "12px";
                            orText.style.margin = "10px 0";
                            orText.style.textAlign = "center";
                            orText.style.fontWeight = "bold";
                            textAreaContainer.appendChild(orText);
                            
                            const directInputLabel = document.createElement("div");
                            directInputLabel.textContent = "Paste base64 data directly below:";
                            directInputLabel.style.fontSize = "12px";
                            directInputLabel.style.marginBottom = "5px";
                            directInputLabel.style.color = "#999";
                            textAreaContainer.appendChild(directInputLabel);
                            
                            const directInput = document.createElement("textarea");
                            directInput.style.width = "100%";
                            directInput.style.height = "100px";
                            directInput.style.padding = "5px";
                            directInput.style.marginBottom = "10px";
                            directInput.style.resize = "vertical";
                            directInput.placeholder = "Paste your base64 data here...";
                            textAreaContainer.appendChild(directInput);
                            
                            const applyButton = document.createElement("button");
                            applyButton.textContent = "Apply Base64 Data";
                            applyButton.style.margin = "0 0 10px 0";
                            applyButton.style.padding = "6px 12px";
                            applyButton.style.backgroundColor = "#5865F2";
                            applyButton.style.color = "white";
                            applyButton.style.border = "none";
                            applyButton.style.borderRadius = "3px";
                            applyButton.style.cursor = "pointer";
                            
                            applyButton.addEventListener("click", () => {
                                const text = directInput.value.trim();
                                if (text && text.length > 0) {
                                    hiddenTextarea.value = text;
                                    setting.value = text;
                                    this.saveSettings();
                                    
                                    const statusDiv = textAreaContainer.querySelector("div:last-child");
                                    statusDiv.textContent = "✓ Base64 data loaded (" + Math.round(text.length / 1024) + " KB)";
                                    statusDiv.style.color = "#43b581";
                                    directInput.value = "";
                                    this.decodeGifs();
                                }
                            });
                            textAreaContainer.appendChild(applyButton);
                            
                            const statusDiv = document.createElement("div");
                            statusDiv.style.marginTop = "5px";
                            statusDiv.style.fontSize = "13px";
                            
                            if (setting.value && setting.value !== "Put it in here!") {
                                statusDiv.textContent = "✓ Base64 data loaded (" + Math.round(setting.value.length / 1024) + " KB)";
                                statusDiv.style.color = "#43b581";
                            } else {
                                statusDiv.textContent = "No base64 data loaded";
                                statusDiv.style.color = "#f04747";
                            }
                            textAreaContainer.appendChild(statusDiv);
                            
                            fileInput.addEventListener("change", (e) => {
                                if (e.target.files && e.target.files[0]) {
                                    const file = e.target.files[0];
                                    const reader = new FileReader();
                                    
                                    reader.onload = (event) => {
                                        const fileContent = event.target.result;
                                        hiddenTextarea.value = fileContent;
                                        setting.value = fileContent;
                                        this.saveSettings();
                                        statusDiv.textContent = "✓ Base64 data loaded from " + file.name + 
                                                              " (" + Math.round(fileContent.length / 1024) + " KB)";
                                        statusDiv.style.color = "#43b581";
                                        this.decodeGifs();
                                    };
                                    
                                    reader.onerror = () => {
                                        statusDiv.textContent = "❌ Error reading file";
                                        statusDiv.style.color = "#f04747";
                                    };
                                    
                                    reader.readAsText(file);
                                }
                            });
                            
                            const clearButton = document.createElement("button");
                            clearButton.textContent = "Clear Data";
                            clearButton.style.margin = "0 0 0 10px";
                            clearButton.style.padding = "6px 12px";
                            clearButton.style.backgroundColor = "#f04747";
                            clearButton.style.color = "white";
                            clearButton.style.border = "none";
                            clearButton.style.borderRadius = "3px";
                            clearButton.style.cursor = "pointer";
                            
                            clearButton.addEventListener("click", () => {
                                hiddenTextarea.value = "";
                                setting.value = "";
                                this.saveSettings();
                                statusDiv.textContent = "Data cleared";
                                statusDiv.style.color = "#f04747";
                                fileInput.value = "";
                                directInput.value = "";
                            });
                            textAreaContainer.appendChild(clearButton);
                            
                            inputElement = textAreaContainer;
                        } else {
                            inputElement = document.createElement("input");
                            inputElement.type = "text";
                            inputElement.value = setting.value;
                            inputElement.style.width = "100%";
                            inputElement.style.padding = "5px";
                            inputElement.style.boxSizing = "border-box";
                            
                            inputElement.addEventListener("change", (e) => {
                                setting.value = e.target.value;
                                this.saveSettings();
                            });
                        }
                        break;
                        
                    case "switch":
                        inputElement = document.createElement("label");
                        inputElement.className = "switch";
                        inputElement.style.display = "inline-block";
                        inputElement.style.position = "relative";
                        
                        const checkbox = document.createElement("input");
                        checkbox.type = "checkbox";
                        checkbox.checked = setting.value;
                        checkbox.style.opacity = "0";
                        checkbox.style.width = "0";
                        checkbox.style.height = "0";
                        
                        const slider = document.createElement("span");
                        slider.className = "slider";
                        slider.style.position = "absolute";
                        slider.style.cursor = "pointer";
                        slider.style.top = "0";
                        slider.style.left = "0";
                        slider.style.right = "0";
                        slider.style.bottom = "0";
                        slider.style.backgroundColor = "#ccc";
                        slider.style.borderRadius = "34px";
                        slider.style.transition = ".4s";
                        slider.style.width = "40px";
                        slider.style.height = "20px";
                        
                        const innerCircle = document.createElement("span");
                        innerCircle.style.position = "absolute";
                        innerCircle.style.content = "";
                        innerCircle.style.height = "16px";
                        innerCircle.style.width = "16px";
                        innerCircle.style.left = "2px";
                        innerCircle.style.bottom = "2px";
                        innerCircle.style.backgroundColor = "white";
                        innerCircle.style.borderRadius = "50%";
                        innerCircle.style.transition = ".4s";
                        innerCircle.style.transform = setting.value ? "translateX(20px)" : "translateX(0)";
                        slider.appendChild(innerCircle);
                        
                        checkbox.addEventListener("change", (e) => {
                            setting.value = e.target.checked;
                            innerCircle.style.transform = setting.value ? "translateX(20px)" : "translateX(0)";
                            slider.style.backgroundColor = setting.value ? "#5865F2" : "#ccc";
                            this.saveSettings();
                        });
                        
                        slider.style.backgroundColor = setting.value ? "#5865F2" : "#ccc";
                        
                        inputElement.appendChild(checkbox);
                        inputElement.appendChild(slider);
                        break;
                }
                
                if (inputElement) {
                    settingContainer.appendChild(inputElement);
                }
                
                categoryContainer.appendChild(settingContainer);
            });
            
            panel.appendChild(categoryContainer);
        });
    }
    
    addStatsSection(panel) {
        const statsContainer = document.createElement("div");
        statsContainer.style.marginTop = "20px";
        statsContainer.style.padding = "15px";
        statsContainer.style.backgroundColor = "#f0f0f0";
        statsContainer.style.borderRadius = "5px";
        
        const statsTitle = document.createElement("h2");
        statsTitle.textContent = "Statistics";
        statsTitle.style.marginBottom = "10px";
        statsContainer.appendChild(statsTitle);
        
        const statsInfo = document.createElement("div");
        statsInfo.textContent = `${this.uniqueUrls.length} GIFs/videos are available`;
        statsInfo.style.marginBottom = "10px";
        statsContainer.appendChild(statsInfo);
        
        const previewButton = document.createElement("button");
        previewButton.textContent = "Show Random GIF";
        previewButton.style.padding = "8px 16px";
        previewButton.style.cursor = "pointer";
        previewButton.style.backgroundColor = "#5865F2";
        previewButton.style.color = "white";
        previewButton.style.border = "none";
        previewButton.style.borderRadius = "3px";
        
        previewButton.onclick = () => {
            const gifUrl = this.getRandomGif();
            if (gifUrl) {
                const preview = document.createElement("div");
                preview.className = "gif-preview";
                preview.style.marginTop = "15px";
                preview.style.maxWidth = "100%";
                preview.style.overflow = "hidden";
                
                const urlText = document.createElement("div");
                urlText.textContent = gifUrl;
                urlText.style.wordBreak = "break-all";
                urlText.style.fontSize = "12px";
                urlText.style.marginBottom = "8px";
                urlText.style.padding = "5px";
                urlText.style.backgroundColor = "#e0e0e0";
                urlText.style.borderRadius = "3px";
                preview.appendChild(urlText);
                
                const copyButton = document.createElement("button");
                copyButton.textContent = "Copy URL";
                copyButton.style.fontSize = "12px";
                copyButton.style.padding = "3px 8px";
                copyButton.style.marginBottom = "8px";
                copyButton.style.cursor = "pointer";
                copyButton.style.backgroundColor = "#4CAF50";
                copyButton.style.color = "white";
                copyButton.style.border = "none";
                copyButton.style.borderRadius = "3px";
                copyButton.onclick = (e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(gifUrl)
                        .then(() => {
                            const originalText = copyButton.textContent;
                            copyButton.textContent = "Copied!";
                            setTimeout(() => {
                                copyButton.textContent = originalText;
                            }, 1500);
                        })
                        .catch(err => {
                            console.error("Failed to copy: ", err);
                            copyButton.textContent = "Copy failed";
                            setTimeout(() => {
                                copyButton.textContent = "Copy URL";
                            }, 1500);
                        });
                };
                preview.appendChild(copyButton);
                
                if (gifUrl.endsWith(".mp4")) {
                    const video = document.createElement("video");
                    video.src = gifUrl;
                    video.controls = true;
                    video.autoplay = true;
                    video.loop = true;
                    video.muted = true;
                    video.style.maxWidth = "100%";
                    video.style.maxHeight = "300px";
                    video.style.borderRadius = "3px";
                    preview.appendChild(video);
                } else {
                    const img = document.createElement("img");
                    img.src = gifUrl;
                    img.style.maxWidth = "100%";
                    img.style.maxHeight = "300px";
                    img.style.borderRadius = "3px";
                    preview.appendChild(img);
                }
                
                const existingPreview = statsContainer.querySelector(".gif-preview");
                if (existingPreview) statsContainer.removeChild(existingPreview);
                statsContainer.appendChild(preview);
            } else {
                const noGifsMessage = document.createElement("div");
                noGifsMessage.textContent = "No GIFs available. Please decode some GIF links first.";
                noGifsMessage.className = "gif-preview";
                noGifsMessage.style.marginTop = "15px";
                noGifsMessage.style.padding = "10px";
                noGifsMessage.style.color = "#721c24";
                noGifsMessage.style.backgroundColor = "#f8d7da";
                noGifsMessage.style.borderRadius = "3px";
                
                const existingPreview = statsContainer.querySelector(".gif-preview");
                if (existingPreview) statsContainer.removeChild(existingPreview);
                statsContainer.appendChild(noGifsMessage);
            }
        };
        
        statsContainer.appendChild(previewButton);
        panel.appendChild(statsContainer);
    }
    
    decodeGifs() {
        const base64Setting = this.findSetting("base64proto2");
        if (!base64Setting) {
            console.error("Could not find base64proto2 setting");
            return null;
        }
        
        try {
            const encodedData = base64Setting.value;
            
            if (!encodedData || encodedData === "Put it in here!") {
                console.warn("No base64 data to decode or default value detected");
                return null;
            }
            
            const decodedData = atob(encodedData);
            console.log("Base64 decoded successfully");
            this.processDecodedData(decodedData);
            return decodedData;
        } catch (error) {
            console.error("Error decoding base64 data:", error);
            return null;
        }
    }
    
    processDecodedData(decodedData) {
        const binaryData = new TextEncoder().encode(decodedData);
        this.extractUrlsFromBinaryData(binaryData);
        this.loadExistingUrls();
        this.processAndSaveUrls();
    }
    
    extractUrlsFromBinaryData(binaryData) {
        const decoder = new TextDecoder('latin1');
        const decodedString = decoder.decode(binaryData);
        const urlRegex = /https?:\/\/[^\s\x00-\x1F<>]*\.(?:gif|mp4)[^\s\x00-\x1F<>]*/g;
        const matches = decodedString.match(urlRegex) || [];
        this.urls = matches;
        console.log(`Found ${this.urls.length} URLs in decoded data`);
    }
    
    loadExistingUrls() {
        try {
            const existingUrls = BdApi.Data.load("InfiniteGifs", "media_urls");
            if (existingUrls && Array.isArray(existingUrls)) {
                console.log(`Loaded ${existingUrls.length} existing URLs`);
                this.urls = [...this.urls, ...existingUrls];
            }
        } catch (error) {
            console.warn("No existing URLs found or error loading");
        }
    }
    
    processAndSaveUrls() {
        this.uniqueUrls = this.urls;
        this.saveUrlsToFile();
        console.log(`Saved ${this.uniqueUrls.length} URLs without processing`);
    }
    
    saveUrlsToFile() {
        BdApi.Data.save("InfiniteGifs", "media_urls", this.uniqueUrls);
        console.log(`Saved ${this.uniqueUrls.length} URLs to storage`);
    }
}

module.exports = InfiniteGifs;