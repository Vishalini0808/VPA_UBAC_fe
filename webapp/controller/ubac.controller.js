sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (Controller, JSONModel, MessageToast) {
    "use strict";

    // true  = tiles without access stay visible but disabled
    // false = tiles without access are hidden
    var SHOW_DISABLED = false;

    // available:false = app not deployed yet (tile shows "Coming soon" and cannot be opened)
    var TILES = {
        masterData:         { semanticObject: "VPAMasterData",     action: "display", available: true },
        approvalMasterData: { semanticObject: "VPAMasterApproval", action: "display", available: true },
        pricing:            { semanticObject: "VPAPricing",        action: "display", available: true },
        approvalPricing:    { semanticObject: "VPAApproval",       action: "display", available: true }
    };

    var LEVEL_TEXT = { act: "Can approve", view: "View only" };

    function tile(sKey, bAllowed, sNote) {
        var bOpen = bAllowed && TILES[sKey].available;
        var aNote = [];

        if (!bAllowed) {
            aNote.push("No access");
        } else {
            if (sNote) { aNote.push(sNote); }
            if (!TILES[sKey].available) { aNote.push("Coming soon"); }
        }

        return {
            allowed: bAllowed,
            open: bOpen,
            visible: bAllowed || SHOW_DISABLED,
            state: bOpen ? "Loaded" : "Disabled",
            note: aNote.join(" | ")
        };
    }

    // "act" wins over "view"; "" = no access to that domain's approvals
    function approvalLevel(aApps, sDomain) {
        if (aApps.indexOf("approval." + sDomain + ".act") !== -1) { return "act"; }
        if (aApps.indexOf("approval." + sDomain + ".view") !== -1) { return "view"; }
        return "";
    }

    return Controller.extend("vpauseraccess.controller.ubac", {

        onInit: function () {
            this.getView().setModel(new JSONModel({
                ready: false,
                none: false,
                error: "",
                masterData: tile("masterData", false),
                approvalMasterData: tile("approvalMasterData", false),
                pricing: tile("pricing", false),
                approvalPricing: tile("approvalPricing", false)
            }), "access");

            this._initShell();
        },

        _initShell: async function () {
            var oUserText = this.byId("userText");
            var oContainer = sap.ushell && sap.ushell.Container;

            if (!oContainer || !oContainer.getServiceAsync) {
                oUserText.setText("");
                this._setError("Launch this app from Work Zone.");
                return;
            }

            var sEmail = "";
            try {
                var oUserInfo = await oContainer.getServiceAsync("UserInfo");
                sEmail = (oUserInfo.getEmail() || "").trim().toLowerCase();
                oUserText.setText(
                    "Logged-in user: " + (oUserInfo.getFullName() || oUserInfo.getId()) +
                    (sEmail ? " (" + sEmail + ")" : "")
                );
            } catch (oError) {
                console.error("Unable to read UserInfo:", oError);
                this._setError("Unable to read the logged-in user.");
                return;
            }

            if (!sEmail) {
                this._setError("Your email address is not available from Work Zone.");
                return;
            }

            try {
                var oAccess = await this._loadAccess(sEmail);
                console.log("me():", oAccess);
                this._applyAccess(oAccess);
            } catch (oError) {
                console.error("Unable to load access:", oError);
                this._setError("Unable to load your access. Please try again later.");
            }
        },

        // Asks the backend which roles/apps belong to this email
        _loadAccess: async function (sEmail) {
            var sSafe = encodeURIComponent(sEmail.replace(/'/g, "''"));
            var sUrl = sap.ui.require.toUrl("vpauseraccess") + "/access/me(email='" + sSafe + "')";

            var oResponse = await fetch(sUrl, { headers: { Accept: "application/json" } });
            if (!oResponse.ok) {
                throw new Error("me() failed: HTTP " + oResponse.status);
            }
            return oResponse.json();
        },

        _applyAccess: function (oAccess) {
            var aApps = (oAccess && oAccess.apps) || [];
            var has = function (sKey) { return aApps.indexOf(sKey) !== -1; };

            var sMd = approvalLevel(aApps, "masterData");
            var sPr = approvalLevel(aApps, "pricing");

            var oData = {
                ready: true,
                error: "",
                masterData: tile("masterData", has("masterData")),
                approvalMasterData: tile("approvalMasterData", !!sMd, LEVEL_TEXT[sMd]),
                pricing: tile("pricing", has("pricing")),
                approvalPricing: tile("approvalPricing", !!sPr, LEVEL_TEXT[sPr])
            };
            oData.none = !(oData.masterData.allowed || oData.approvalMasterData.allowed ||
                           oData.pricing.allowed || oData.approvalPricing.allowed);

            this.getView().getModel("access").setData(oData);
        },

        _setError: function (sMessage) {
            this.getView().getModel("access").setProperty("/error", sMessage);
        },

        _navigate: async function (sKey) {
            var oModel = this.getView().getModel("access");

            if (!oModel.getProperty("/" + sKey + "/allowed")) {
                MessageToast.show("You do not have access to this application.");
                return;
            }
            if (!oModel.getProperty("/" + sKey + "/open")) {
                MessageToast.show("This application is not available yet.");
                return;
            }

            var oContainer = sap.ushell && sap.ushell.Container;
            if (!oContainer || !oContainer.getServiceAsync) {
                MessageToast.show("Launch this application from Work Zone.");
                return;
            }

            try {
                var oNav = await oContainer.getServiceAsync("Navigation");
                oNav.navigate({ target: {
                    semanticObject: TILES[sKey].semanticObject,
                    action: TILES[sKey].action
                } });
            } catch (oError) {
                console.error("Navigation failed:", oError);
                MessageToast.show("Navigation is not available.");
            }
        },

        onMasterDataPress:     function () { this._navigate("masterData"); },
        onMasterApprovalPress: function () { this._navigate("approvalMasterData"); },
        onPricingPress:        function () { this._navigate("pricing"); },
        onPricingApprovalPress: function () { this._navigate("approvalPricing"); }
    });
});