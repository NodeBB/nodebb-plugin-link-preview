<div class="card col-6 position-relative" component="link-preview">
	{{{ if images.length }}}
	{{{ each images }}}
	{{{ if @first }}}
	<div class="d-block overflow-hidden" style="max-height: 15rem;">
		<img src="{@value}" class="card-img-top" />
	</div>
	{{{ end }}}
	{{{ end }}}
	{{{ end }}}
	<div class="card-body">
		<h5 class="card-title">{title}</h5>
		<p class="card-text line-clamp-3">{description}</p>
		<a href="{url}" class="stretched-link"></a>
	</div>
	<div class="card-footer text-body-secondary small d-flex gap-2 align-items-center lh-2">
		{{{ if favicons.length }}}
		{{{ each favicons }}}
		{{{ if @first }}}
		<img src="{@value}" alt="favicon" style="max-width: 21px; max-height: 21px;" />
		{{{ end }}}
		{{{ end }}}
		{{{ end }}}
		<p class="d-inline-block text-truncate mb-0">{siteName} <span class="text-secondary">({hostname})</span></p>
	</div>
</div>