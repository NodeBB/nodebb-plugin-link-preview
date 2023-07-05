<div class="acp-page-container">
	<!-- IMPORT admin/partials/settings/header.tpl -->

	<div class="row m-0">
		<div id="spy-container" class="col-12 col-md-8 px-0 mb-4" tabindex="0">
			<form role="form" class="link-preview-settings">
				<div class="mb-4">
					<h5 class="fw-bold tracking-tight settings-header">Media Types</h5>

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

					<p class="form-text">
						Please note that the "audio" and "video" formats only apply if the URL is a direct link to the audio/video file.
						Links to video hosting sites (e.g. YouTube) would fall under the "websites" category unless explicitly covered by a special embed type.
					</p>
				</div>

				<div class="mb-4">
					<h5 class="fw-bold tracking-tight settings-header">Special Embeds</h5>

					<p>
						The following rules allow for more interactive previews via pre-defined defaults.
						If disabled, then they will be treated like a regular "website" media type.
					</p>

					<div class="form-check form-switch mb-3">
						<input type="checkbox" class="form-check-input" id="embedYoutube" name="embedYoutube">
						<label for="embedYoutube" class="form-check-label">YouTube</label>
					</div>

					<div class="form-check form-switch mb-3">
						<input type="checkbox" class="form-check-input" id="embedVimeo" name="embedVimeo">
						<label for="embedVimeo" class="form-check-label">Vimeo</label>
					</div>
				</div>
			</form>
		</div>

		<!-- IMPORT admin/partials/settings/toc.tpl -->
	</div>
</div>