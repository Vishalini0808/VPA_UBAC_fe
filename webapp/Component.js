sap.ui.define([
    "sap/ui/core/UIComponent",
    "vpauseraccess/model/models",
    "vpauseraccess/model/access"
], (UIComponent, models, Access) => {
    "use strict";

    return UIComponent.extend("vpauseraccess.Component", {
        metadata: {
            manifest: "json",
            interfaces: [
                "sap.ui.core.IAsyncContentCreation"
            ]
        },

        init() {
            // call the base component's init function
            UIComponent.prototype.init.apply(this, arguments);

            // set the device model
            this.setModel(models.createDeviceModel(), "device");

            // set the access model
            const oModel = Access.createModel();
            this.setModel(oModel, "access");

            // which launchpad tile opened the app? (default parameter "mode" of the intent)
            const oData = this.getComponentData();
            const oParams = (oData && oData.startupParameters) || {};
            const sMode = (oParams.mode && oParams.mode[0]) || "";
            console.log("VPA tile mode:", sMode);

            Access.load(oModel, sMode).then((oDecision) => {
                if (oDecision && oDecision.screen === "redirect") {
                    return Access.handleRedirect(oModel, sMode, oDecision.target);
                }
            }).catch((oError) => console.error("Startup failed:", oError));

            // enable routing
            this.getRouter().initialize();
        }
    });
});