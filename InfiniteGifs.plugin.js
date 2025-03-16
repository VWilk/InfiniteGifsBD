/**
 * @name InfiniteGifs
 * @author VWilk
 * @authorId 363358047784927234
 * @version 1.0.0
 * @description A BetterDiscord plugin to fetch and display GIFs from a GitHub repository.
 * @source https://github.com/VWilk/gifstorage/
 */

let config = {
    changelog: [
        {
            title: "Version 1.0.0",
            type: "added",
            items: ["Initial release"],
        },
        {
            title: "Bugs Sat On",
            type: "fixed",
            items: ["Fixed the initial release"],
        },
        {
            title: "On-going",
            type: "progress",
            items: [
                "Automatically sync with GitHub?",
                "Sync between mobile client.",
                "Different gif profiles.",
                "Gif search?",
            ],
        },
    ],
    settings: [
        {
            type: "category",
            id: "basic",
            name: "Setup",
            collapsible: true,
            shown: false,
            settings: [
                {
                    type: "text",
                    id: "userGithubToken",
                    name: "GitHub API Token",
                    note: "GitHub API token here!",
                    value: "",
                },
                {
                    type: "switch",
                    id: "basicSwitch",
                    name: "Basic Switch",
                    note: "Basic switch with no fluff",
                    value: false,
                },
            ],
        },
    ],
    saveSettings() {
        BdApi.Data.save("InfiniteGifs", "settings", this.settings);
    },
    loadSettings() {
        const loaded = BdApi.Data.load("InfiniteGifs", "settings");
        if (loaded) {
            this.settings = loaded;
        }
    },

    findSetting(id) {
        console.log(id)
        return this.settings[0].settings.find(s => s.id === id);
    }
};

class InfiniteGifs {
    constructor(meta) {
        this.meta = meta;
        this.githubRepo = "VWilk/gifstorage";
        config.loadSettings();
        this.githubToken = config.findSetting("userGithubToken").value;
    }

    start() {
        console.log(this.githubToken)
    }

    stop() {
        console.log("Plugin disabled.");
    }


    getSettingsPanel() {
        return BdApi.UI.buildSettingsPanel({
            settings: config.settings,
            onChange: (settingGroup, settingId, value) => {
                console.log("Changed setting", settingGroup, settingId, value);
                console.log("-----------------------------------------")
                this.updateUserSettings(settingGroup, settingId, value);
            },
        });
    }

    updateUserSettings(settingGroup, settingId, value) {
        console.log("Still going... WITH ID:", settingGroup, "OF VALUE:", value)
        const setting = config.findSetting(settingId);
        console.log("Still going, POST SETTINGS", setting);
        if (setting) setting.value = value;
        console.log("Updated setting", setting.value );
        config.saveSettings();
    }

};


module.exports = InfiniteGifs;