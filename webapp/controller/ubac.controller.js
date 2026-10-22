sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "vpauseraccess/model/access"
], function (Controller, MessageToast, MessageBox, Access) {
    "use strict";

    return Controller.extend("vpauseraccess.controller.ubac", {

        onInit: function () {
            // The "access" model is created and filled by Component.js
            this._oModel = this.getOwnerComponent().getModel("access");

            // load the assignments as soon as the UBAC screen is shown
            this._oScreenBinding = this._oModel.bindProperty("/screen");
            this._oScreenBinding.attachChange(function () {
                if (this._oModel.getProperty("/screen") === "ubac") { this._loadUsers(); }
            }, this);
        },

        onExit: function () {
            this._oScreenBinding.destroy();
        },

        // ---------- navigation ----------

        // Tile on the 2-tile screen. View passes the key via customData "dest", e.g. "pricing.submit".
        onDestinationPress: function (oEvent) {
            Access.go(this._oModel, oEvent.getSource().data("dest"));
        },

        // Back to the launchpad
        onNavBack: function () {
            Access.goBack();
        },

        // ---------- UBAC admin screen (UserRoles) ----------

        // Every call sends the caller's email; the backend returns 403 for non-admins
        _api: async function (sMethod, sPath, oBody) {
            var oResponse = await fetch(Access.base() + sPath, {
                method: sMethod,
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    "x-user-email": this._oModel.getProperty("/email")
                },
                body: oBody ? JSON.stringify(oBody) : undefined
            });
            if (!oResponse.ok) { throw await Access.toError(oResponse); }
            return oResponse.status === 204 ? null : oResponse.json();
        },

        _loadUsers: async function () {
            var oModel = this._oModel;
            oModel.setProperty("/admin/busy", true);
            try {
                var oResult = await this._api("GET", "UserRoles?$select=ID,userId,role&$orderby=userId,role");
                oModel.setProperty("/admin/items", (oResult && oResult.value) || []);
            } catch (oError) {
                console.error("Loading UserRoles failed:", oError);
                MessageToast.show("Unable to load assignments: " + oError.message);
            } finally {
                oModel.setProperty("/admin/busy", false);
            }
        },

        onAddUser: async function () {
            var oModel = this._oModel;
            var sEmail = Access.clean(oModel.getProperty("/admin/newEmail"));
            var sRole = oModel.getProperty("/admin/newRole");

            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sEmail)) {
                MessageToast.show("Enter a valid email address.");
                return;
            }
            if (!sRole) {
                MessageToast.show("Select a role.");
                return;
            }

            try {
                await this._api("POST", "UserRoles", { userId: sEmail, role: sRole });
                oModel.setProperty("/admin/newEmail", "");
                oModel.setProperty("/admin/newRole", "");
                MessageToast.show("Assignment added.");
                this._loadUsers();
            } catch (oError) {
                console.error("Add failed:", oError);
                MessageBox.error("Could not add the assignment.\n" + oError.message);
            }
        },

        // Table mode="Delete" fires the "delete" event with the row as "listItem"
        onDeleteUser: function (oEvent) {
            var oItem = oEvent.getParameter("listItem").getBindingContext("access").getObject();

            // Safety guard: an admin cannot remove their own Admin role (would lock them out)
            if (oItem.userId === this._oModel.getProperty("/email") && oItem.role === "Admin") {
                MessageToast.show("You cannot remove your own Admin role.");
                return;
            }

            MessageBox.confirm("Remove " + oItem.role + " from " + oItem.userId + "?", {
                onClose: async function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }
                    try {
                        await this._api("DELETE", "UserRoles(" + oItem.ID + ")");
                        MessageToast.show("Assignment removed.");
                        this._loadUsers();
                    } catch (oError) {
                        console.error("Delete failed:", oError);
                        MessageBox.error("Could not remove the assignment.\n" + oError.message);
                    }
                }.bind(this)
            });
        }
    });
});