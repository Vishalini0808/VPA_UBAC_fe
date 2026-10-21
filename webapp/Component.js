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

            // set the access model (filled below)
            const oModel = Access.createModel();
            this.setModel(oModel, "access");

            // Start the router only after access is known, so a single-destination
            // user is redirected before the hub is ever drawn.
            Access.load(oModel).then((oData) => {
                const sTarget = oData ? Access.redirectTarget(oData) : "";
                return sTarget ? Access.go(oModel, sTarget) : false;
            }).catch((oError) => {
                console.error("Startup failed:", oError);
                return false;
            }).then((bRedirected) => {
                if (!bRedirected) {
                    // enable routing
                    this.getRouter().initialize();
                }
            });
        }
    });
});