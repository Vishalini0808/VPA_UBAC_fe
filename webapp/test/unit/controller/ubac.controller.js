/*global QUnit*/

sap.ui.define([
	"vpauseraccess/controller/ubac.controller"
], function (Controller) {
	"use strict";

	QUnit.module("ubac Controller");

	QUnit.test("I should test the ubac controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
