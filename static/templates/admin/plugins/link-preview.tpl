<form role="form" class="link-preview-settings">
	<div class="row mb-4">
		<div class="col-sm-2 col-12 settings-header">General</div>
		<div class="col-sm-10 col-12">
			<p class="lead">
				Adjust these settings. You can then retrieve these settings in code via:
				<code>meta.settings.get('link-preview', function(err, settings) {...});</code>
			</p>
			<div class="mb-3">
				<label class="form-label" for="setting1">Setting 1</label>
				<input type="text" id="setting1" name="setting1" title="Setting 1" class="form-control" placeholder="Setting 1">
			</div>
			<div class="mb-3">
				<label class="form-label" for="setting2">Setting 2</label>
				<input type="text" id="setting2" name="setting2" title="Setting 2" class="form-control" placeholder="Setting 2">
			</div>

			<div class="form-check">
				<input type="checkbox" class="form-check-input" id="setting3" name="setting3">
				<label for="setting3" class="form-check-label">Setting 3</label>
			</div>
		</div>
	</div>
</form>

<!-- IMPORT admin/partials/save_button.tpl -->