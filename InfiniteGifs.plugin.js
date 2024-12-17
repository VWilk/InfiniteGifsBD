/**
 * @name InfiniteGifs
 * @author VWilk
 * @authorId 363358047784927234
 * @version 1.0.0
 * @description A BetterDiscord plugin to fetch and display GIFs from a GitHub repository.
 * @source https://github.com/VWilk/gifstorage/
 */


const API = BdApi;

const config = {
    changelog: [
        {
            title: "Version 1.0.0",
            type: "added",
            items: [
                "Initial release"
            ]
        },
        {
            title: "Bugs Sat On",
            type: "fixed",
            items: [
                "Fixed the initial release"
            ]
        },
        {
            title: "On-going",
            type: "progress",
            items: [
                "Automatically sync with github?",
                "Sync between mobile client.",
                "Different gif profiles",
                "Gif search?"
            ]
        }
    ],
    settings: [
        {
            type: "category",
            id: "basic",
            name: "Setup",
            collapsible: true,
            shown: false,
            settings: [
                { type: "text", id: "userGithubToken", name: "Github API Token", note: "Github API token here!", value: "Github token here" },
                { type: "switch", id: "switch", name: "Basic Switch", note: "Basic switch with no fluff", value: false }
            ]
        }],
    saveSettings: function() {
        API.Data.save("InfiniteGifs", "config", this.settings);
    }
}


class InfiniteGifs {
    constructor(meta) {
        this.githubRepo = "VWilk/gifstorage";
        this.githubToken = config.settings[0].settings.find(s => s.id === "userGithubToken").value;
        this.meta = meta;
    }

    start() {
        console.log("Enabled");
    }

    stop() {
        console.log("Disabled");
    }

    getSettingsPanel() {
        config.saveSettings();
        console.log(config.settings)
        return API.UI.buildSettingsPanel({
            settings: config.settings,
            onChange: (category, id, value) => console.log(category, id, value)
        });
    }

    buildSettings() {

    }
    loadSettings() {
    }
};

module.exports = InfiniteGifs;