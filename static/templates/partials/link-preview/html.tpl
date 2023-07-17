<div class="card col-md-9 col-lg-6 position-relative link-preview">
	{{{ if images.length }}}
	{{{ each images }}}
	{{{ if @first }}}
	<a href="{url}">
		<img src="{@value}" class="card-img-top not-responsive" style="max-height: 15rem;" />
	</a>
	{{{ end }}}
	{{{ end }}}
	{{{ end }}}
	<div class="card-body">
		<h5 class="card-title">
			<a href="{url}">
				{title}
			</a>
		</h5>
		<p class="card-text line-clamp-3">{description}</p>
	</div>
	<a href="{url}" class="card-footer text-body-secondary small d-flex gap-2 align-items-center lh-2">
		{{{ if favicons.length }}}
		{{{ each favicons }}}
		{{{ if @first }}}
		<img src="{@value}" alt="favicon" class="not-responsive" style="max-width: 21px; max-height: 21px;" />
		{{{ end }}}
		{{{ end }}}
		{{{ end }}}
		<p class="d-inline-block text-truncate mb-0">{siteName} <span class="text-secondary">({hostname})</span></p>
	</a>
</div>