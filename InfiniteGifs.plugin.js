/**
 * @name InfiniteGifs
 * @author VWilk
 * @authorId 363358047784927234
 * @version 1.0.0
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
        version: "1.0.0",
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
            title: "Bugs Fixed",
            type: "fixed",
            items: ["Fixed the initial release"]
        },
        {
            title: "On-going",
            type: "progress",
            items: [
                "Automatically sync with GitHub?",
                "Sync between mobile client.",
                "Different gif profiles.",
                "Gif search?"
            ]
        }
    ],
    defaultConfig: [
        {
            type: "category",
            id: "basic",
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
                    value: "VWilk/gifstorage"
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

class GithubAdapter {
    // Empty adapter class as requested
    constructor() {}
}

class InfiniteGifs {
    constructor() {
        this.settings = this.loadSettings();
        this.githubAdapter = null;
    }

    loadSettings() {
        let saved = BdApi.Data.load("InfiniteGifs", "settings");
        console.log(saved)
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
    }

    stop() {
        console.log(`${config.info.name} plugin stopped`);
    }

    getSettingsPanel() {
        return BdApi.UI.buildSettingsPanel({
            settings: this.settings,
            onChange: (settingGroup, settingId, value) => {
                const setting = this.findSetting(settingId);
                if (setting) {
                    setting.value = value;
                    this.saveSettings();
                }
            }
        });
    }
}

module.exports = InfiniteGifs;