'use strict';

define('admin/plugins/link-preview', ['settings'], function (settings) {
	var ACP = {};

	ACP.init = function () {
		settings.load('link-preview', $('.link-preview-settings'));
		$('#save').on('click', saveSettings);
	};

	function saveSettings() {
		settings.save('link-preview', $('.link-preview-settings'));
	}

	return ACP;
});
