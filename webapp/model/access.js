sap.ui.define([
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (JSONModel, MessageToast) {
    "use strict";

    // true  = tiles without access stay visible but disabled (never applies to the UBAC tile)
    // false = tiles without access are hidden
    var SHOW_DISABLED = false;

    // available:false = app not deployed yet (tile shows "Coming soon" and cannot be opened)
    var DESTINATIONS = {
        "masterData.submit":  { group: "masterData", semanticObject: "VPAMasterData",     action: "display", available: true,  text: "Master Data Submitter" },
        "masterData.approve": { group: "masterData", semanticObject: "VPAMasterApproval", action: "display", available: false, text: "Master Data Approver" },
        "pricing.submit":     { group: "pricing",    semanticObject: "VPAPricing",        action: "display", available: true,  text: "Pricing Submitter" },
        "pricing.approve":    { group: "pricing",    semanticObject: "VPAApproval",       action: "display", available: true,  text: "Pricing Approver" }
    };

    var GROUP_PAGES = { masterData: "pageMasterData", pricing: "pagePricing" };

    var ROLES = ["Admin", "MasterDataSubmitter", "MasterDataApprover", "PricingSubmitter", "PricingApprover"];

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

    // Everything the tiles need, computed only from the "apps" array
    function buildAccess(aApps) {
        var has = function (sKey) { return aApps.indexOf(sKey) !== -1; };
        var oDest = {};
        var oGroups = {};

        Object.keys(DESTINATIONS).forEach(function (sKey) {
            oDest[modelKey(sKey)] = destinationState(sKey, has(sKey));
        });

        Object.keys(GROUP_PAGES).forEach(function (sGroup) {
            var aAllowed = Object.keys(DESTINATIONS).filter(function (sKey) {
                return DESTINATIONS[sKey].group === sGroup && has(sKey);
            });
            // exactly one destination -> go straight to it; two -> sub-view
            var sTarget = aAllowed.length === 1 ? aAllowed[0] : "";
            var oOnly = sTarget ? oDest[modelKey(sTarget)] : null;
            var bOpen = oOnly ? oOnly.open : aAllowed.length > 0;

            oGroups[sGroup] = {
                allowed: aAllowed.length > 0,
                visible: aAllowed.length > 0 || SHOW_DISABLED,
                open: bOpen,
                state: bOpen ? "Loaded" : "Disabled",
                note: oOnly ? oOnly.note : (aAllowed.length ? "" : "No access"),
                target: sTarget
            };
        });

        var bAdmin = has("ubac.manage");
        oGroups.ubac = {
            allowed: bAdmin,
            visible: bAdmin,          // never shown to non-admins
            open: bAdmin,
            state: bAdmin ? "Loaded" : "Disabled",
            note: "",
            target: ""
        };

        return {
            groups: oGroups,
            dest: oDest,
            none: !Object.keys(oGroups).some(function (g) { return oGroups[g].allowed; })
        };
    }

    // The single "access" model, created once by Component.js
    function createModel() {
        var oData = buildAccess([]);
        oData.ready = false;
        oData.error = "";
        oData.email = "";
        oData.userText = "Checking logged-in user...";
        oData.admin = {
            busy: false,
            items: [],
            newEmail: "",
            newRole: "",
            roles: ROLES.map(function (r) { return { key: r }; })
        };
        return new JSONModel(oData);
    }

    // Reads the shell user, calls me(), fills the model. Never throws.
    // Resolves with the buildAccess() result, or null when access could not be loaded.
    async function load(oModel) {
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

            var oData = buildAccess((oAccess && oAccess.apps) || []);
            oModel.setProperty("/groups", oData.groups);
            oModel.setProperty("/dest", oData.dest);
            oModel.setProperty("/none", oData.none);
            oModel.setProperty("/error", "");
            oModel.setProperty("/ready", true);
            return oData;
        } catch (oError) {
            console.error("Unable to load access:", oError);
            oModel.setProperty("/error", "Unable to load your access. Please try again later.");
            return null;
        }
    }

    // Returns the destination key to open straight away, or "" to show the hub.
    // Only a user with exactly one allowed group that has exactly one destination is redirected.
    // The flag stops a redirect loop when the user comes back with the browser back button.
    function redirectTarget(oData) {
        var aGroups = Object.keys(oData.groups).filter(function (g) {
            return oData.groups[g].allowed;
        });
        if (aGroups.length !== 1) { return ""; }

        var oGroup = oData.groups[aGroups[0]];
        if (!oGroup.target || !oGroup.open) { return ""; }   // UBAC, sub-view case, or "Coming soon"

        try {
            var oStore = window.sessionStorage;
            if (oStore.getItem("vpaAutoNav")) {              // we just came back: show the hub
                oStore.removeItem("vpaAutoNav");
                return "";
            }
            oStore.setItem("vpaAutoNav", "1");
        } catch (e) {
            return "";                                       // storage blocked: stay on the hub, no loop risk
        }
        return oGroup.target;
    }

    // Opens an app through the shell. Resolves true when navigation was started.
    async function go(oModel, sKey) {
        var oDest = oModel.getProperty("/dest/" + modelKey(sKey));

        if (!oDest || !oDest.allowed) {
            MessageToast.show("You do not have access to this application.");
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

    return {
        DESTINATIONS: DESTINATIONS,
        GROUP_PAGES: GROUP_PAGES,
        clean: clean,
        base: base,
        toError: toError,
        createModel: createModel,
        load: load,
        redirectTarget: redirectTarget,
        go: go
    };
});