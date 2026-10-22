sap.ui.define([
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (JSONModel, MessageToast) {
    "use strict";

    // true  = destination tiles without access stay visible but disabled
    // false = destination tiles without access are hidden
    var SHOW_DISABLED = false;

    var AUTO_NAV_FLAG = "vpaAutoNav";

    // available:false = app not deployed yet (tile shows "Coming soon" and cannot be opened)
    var DESTINATIONS = {
        "masterData.submit":  { group: "masterData", semanticObject: "VPAMasterData",     action: "display", available: true,  text: "Master Data Submitter" },
        "masterData.approve": { group: "masterData", semanticObject: "VPAMasterApproval", action: "display", available: true, text: "Master Data Approver" },
        "pricing.submit":     { group: "pricing",    semanticObject: "VPAPricing",        action: "display", available: true,  text: "Pricing Submitter" },
        "pricing.approve":    { group: "pricing",    semanticObject: "VPAApproval",       action: "display", available: true,  text: "Pricing Approver" }
    };

    var ROLES = ["Admin", "MasterDataSubmitter", "MasterDataApprover", "PricingSubmitter", "PricingApprover"];

    var TITLES = { masterData: "Master Data", pricing: "Pricing Calculation", ubac: "User Access Control" };

    var MESSAGES = {
        denied:  { title: "No access",    text: "You do not have access to this application." },
        soon:    { title: "Coming soon",  text: "This application is not available yet." },
        unknown: { title: "Unknown tile", text: "Please open this application from one of the VPA tiles in the launchpad." }
    };

    function clean(s) { return String(s || "").trim().toLowerCase(); }

    // "masterData.submit" -> "masterData_submit" (safe as a binding path)
    function modelKey(sKey) { return sKey.replace(".", "_"); }

    function base() { return sap.ui.require.toUrl("vpauseraccess") + "/access/"; }

    async function toError(oResponse) {
        var sMessage = "HTTP " + oResponse.status;
        try {
            var oBody = await oResponse.json();
            if (oBody && oBody.error && oBody.error.message) { sMessage = oBody.error.message; }
        } catch (e) { /* no JSON body */ }
        return new Error(sMessage);
    }

    // ---------- tile logic (computed only from the "apps" array) ----------

    function destinationState(sKey, bAllowed) {
        var bOpen = bAllowed && DESTINATIONS[sKey].available;
        var sNote = "";
        if (!bAllowed) {
            sNote = "No access";
        } else if (!DESTINATIONS[sKey].available) {
            sNote = "Coming soon";
        }
        return {
            allowed: bAllowed,
            open: bOpen,
            visible: bAllowed || SHOW_DISABLED,
            state: bOpen ? "Loaded" : "Disabled",
            note: sNote,
            target: sKey
        };
    }

    function buildDest(aApps) {
        var oDest = {};
        Object.keys(DESTINATIONS).forEach(function (sKey) {
            oDest[modelKey(sKey)] = destinationState(sKey, aApps.indexOf(sKey) !== -1);
        });
        return oDest;
    }

    // What should the hub do for the tile (mode) that was clicked?
    //   { screen: "masterData" | "pricing" | "ubac" } -> show that screen
    //   { screen: "redirect", target }                -> exactly one destination: open it directly
    //   { screen: "denied" | "soon" | "unknown" }     -> message screen
    function decide(aApps, sMode) {
        var has = function (sKey) { return aApps.indexOf(sKey) !== -1; };

        if (sMode === "ubac") {
            return has("ubac.manage") ? { screen: "ubac" } : { screen: "denied" };
        }
        if (sMode !== "masterData" && sMode !== "pricing") {
            return { screen: "unknown" };
        }

        var aAllowed = Object.keys(DESTINATIONS).filter(function (sKey) {
            return DESTINATIONS[sKey].group === sMode && has(sKey);
        });

        if (aAllowed.length === 0) { return { screen: "denied" }; }
        if (aAllowed.length === 1) {
            return DESTINATIONS[aAllowed[0]].available
                ? { screen: "redirect", target: aAllowed[0] }
                : { screen: "soon" };
        }
        return { screen: sMode };           // two destinations -> 2-tile screen
    }

    function applyDecision(oModel, oDecision) {
        var oMessage = MESSAGES[oDecision.screen];
        if (oMessage) {
            oModel.setProperty("/messageTitle", oMessage.title);
            oModel.setProperty("/messageText", oMessage.text);
            oModel.setProperty("/screen", "message");
        } else {
            oModel.setProperty("/screen", oDecision.screen);
        }
    }

    // ---------- model ----------

    function createModel() {
        return new JSONModel({
            screen: "loading",      // loading | masterData | pricing | ubac | message
            title: "VPA",
            messageTitle: "",
            messageText: "",
            error: "",
            email: "",
            userText: "Checking logged-in user...",
            dest: buildDest([]),
            admin: {
                busy: false,
                items: [],
                newEmail: "",
                newRole: "",
                roles: ROLES.map(function (r) { return { key: r }; })
            }
        });
    }

    // Reads the shell user, calls me(), fills the model. Never throws.
    // Resolves with the decision, or null when access could not be loaded.
    async function load(oModel, sMode) {
        oModel.setProperty("/title", TITLES[sMode] || "VPA");

        var oContainer = sap.ushell && sap.ushell.Container;
        if (!oContainer || !oContainer.getServiceAsync) {
            oModel.setProperty("/userText", "");
            oModel.setProperty("/error", "Launch this app from Work Zone.");
            return null;
        }

        var sEmail = "";
        try {
            var oUserInfo = await oContainer.getServiceAsync("UserInfo");
            sEmail = clean(oUserInfo.getEmail());
            oModel.setProperty("/userText",
                "Logged-in user: " + (oUserInfo.getFullName() || oUserInfo.getId()) +
                (sEmail ? " (" + sEmail + ")" : ""));
        } catch (oError) {
            console.error("Unable to read UserInfo:", oError);
            oModel.setProperty("/userText", "");
            oModel.setProperty("/error", "Unable to read the logged-in user.");
            return null;
        }

        if (!sEmail) {
            oModel.setProperty("/error", "Your email address is not available from Work Zone.");
            return null;
        }
        oModel.setProperty("/email", sEmail);

        try {
            var sSafe = encodeURIComponent(sEmail.replace(/'/g, "''"));
            var oResponse = await fetch(base() + "me(email='" + sSafe + "')", {
                headers: { Accept: "application/json" }
            });
            if (!oResponse.ok) { throw await toError(oResponse); }

            var oAccess = await oResponse.json();
            console.log("me():", oAccess);

            var aApps = (oAccess && oAccess.apps) || [];
            oModel.setProperty("/dest", buildDest(aApps));

            var oDecision = decide(aApps, sMode);
            if (oDecision.screen !== "redirect") { applyDecision(oModel, oDecision); }
            return oDecision;
        } catch (oError) {
            console.error("Unable to load access:", oError);
            oModel.setProperty("/error", "Unable to load your access. Please try again later.");
            return null;
        }
    }

    // ---------- navigation ----------

    // Opens an app through the shell. Resolves true when navigation was started.
    async function go(oModel, sKey) {
        var oDest = oModel.getProperty("/dest/" + modelKey(sKey));

        if (!oDest || !oDest.allowed) {
            MessageToast.show("No access");
            return false;
        }
        if (!oDest.open) {
            MessageToast.show("This application is not available yet.");
            return false;
        }

        var oContainer = sap.ushell && sap.ushell.Container;
        if (!oContainer || !oContainer.getServiceAsync) {
            MessageToast.show("Launch this application from Work Zone.");
            return false;
        }

        try {
            var oNavigation = await oContainer.getServiceAsync("Navigation");
            oNavigation.navigate({ target: {
                semanticObject: DESTINATIONS[sKey].semanticObject,
                action: DESTINATIONS[sKey].action
            } });
            return true;
        } catch (oError) {
            console.error("Navigation failed:", oError);
            MessageToast.show("Navigation is not available.");
            return false;
        }
    }

    // One step back in the shell (to the launchpad). Resolves true when it was triggered.
    async function goBack() {
        try {
            var oContainer = sap.ushell && sap.ushell.Container;
            var oNavigation = await oContainer.getServiceAsync("Navigation");
            if (oNavigation.backToPreviousApp) {
                await oNavigation.backToPreviousApp();
            } else {
                window.history.back();
            }
            return true;
        } catch (oError) {
            console.warn("Back navigation failed:", oError);
            return false;
        }
    }

    // Single-destination user: open the app straight away.
    // History is launchpad -> hub -> app, so when the user comes back to the hub with "back"
    // (flag still set) it continues back to the launchpad instead of redirecting again.
    async function handleRedirect(oModel, sMode, sKey) {
        var oStore = null;
        try { oStore = window.sessionStorage; } catch (e) { /* blocked */ }

        // Fallback: show the screen with the one allowed tile instead of redirecting
        var showTiles = function () { applyDecision(oModel, { screen: sMode }); };

        if (!oStore) { showTiles(); return; }

        if (oStore.getItem(AUTO_NAV_FLAG)) {
            oStore.removeItem(AUTO_NAV_FLAG);
            if (!(await goBack())) { showTiles(); }
            return;
        }

        oStore.setItem(AUTO_NAV_FLAG, "1");
        if (!(await go(oModel, sKey))) {
            oStore.removeItem(AUTO_NAV_FLAG);
            showTiles();
        }
    }

    return {
        clean: clean,
        base: base,
        toError: toError,
        createModel: createModel,
        load: load,
        go: go,
        goBack: goBack,
        handleRedirect: handleRedirect
    };
});