<form role="form" class="link-preview-settings">
	<div class="row mb-4">
		<div class="col-sm-2 col-12 settings-header">Media Types</div>
		<div class="col-sm-10 col-12">
			<p>
				If enabled, URLs of those types will be converted to preview boxes.
			</p>

			<div class="form-check form-switch mb-3">
				<input type="checkbox" class="form-check-input" id="embedHtml" name="embedHtml">
				<label for="embedHtml" class="form-check-label">Websites</label>
			</div>

			<div class="form-check form-switch mb-3">
				<input type="checkbox" class="form-check-input" id="embedImage" name="embedImage">
				<label for="embedImage" class="form-check-label">Images</label>
			</div>

			<div class="form-check form-switch mb-3">
				<input type="checkbox" class="form-check-input" id="embedAudio" name="embedAudio">
				<label for="embedAudio" class="form-check-label">Audio</label>
			</div>

			<div class="form-check form-switch mb-3">
				<input type="checkbox" class="form-check-input" id="embedVideo" name="embedVideo">
				<label for="embedVideo" class="form-check-label">Video</label>
			</div>

			<p class="help-text">
				Please note that the "audio" and "video" formats only apply if the URL is a direct link to the audio/video file. Links to video hosting sites (e.g. YouTube) would fall under the "websites" category.
			</p>
		</div>
	</div>
</form>

<!-- IMPORT admin/partials/save_button.tpl -->
