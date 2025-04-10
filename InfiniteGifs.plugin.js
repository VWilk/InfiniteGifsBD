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
            shown: true,
            settings: [
                {
                type: "category",
                id: "basic",
                name: "Setup",
                collapsible: true,
                shown: true,
                settings: [
                    {
                        type: "text",
                        id: "userGithubToken",
                        name: "GitHub API Token",
                        note: "GitHub API token here!",
                        value: "",
                    },
                    {
                        type: "text",
                        id: "userGithubRepositoryName",
                        name: "Github Repository Name eg: username/githubRepository",
                        note: "Github Repository Name eg: username/githubRepository",
                        value: "",
                    },
                    {
                        type: "switch",
                        id: "GithubOnOff",
                        name: "GithubSwitch",
                        note: "Turn on or off functionality of Github.",
                        value: false,
                    },
                ]
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

class GithubAdapter {
    
}



class InfiniteGifs {
    constructor(meta) {
        this.meta = meta;
        this.githubRepo = "VWilk/gifstorage";
        config.loadSettings();
        this.githubToken = config.findSetting("userGithubToken").value;
    }

    start() {
    }

    stop() {
        console.log("Plugin disabled.");
    }


    getSettingsPanel() {
        return BdApi.UI.buildSettingsPanel({
            settings: config.settings,
            onChange: (settingGroup, settingId, value) => {
                this.updateUserSettings(settingGroup, settingId, value);
            },
        });
    }

    updateUserSettings(settingGroup, settingId, value) {
        const setting = config.findSetting(settingId);
        if (setting) setting.value = value;
        config.saveSettings();
    }

};


module.exports = InfiniteGifs;