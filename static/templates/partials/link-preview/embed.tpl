<div class="card col-6 position-relative">
	{{{ if images.length }}}
	{{{ each images }}}
	{{{ if @first }}}
	<img src="{@value}" class="card-img-top" />
	{{{ end }}}
	{{{ end }}}
	{{{ end }}}
	<div class="card-body">
		<h5 class="card-title">{title}</h5>
		<p class="card-text">{description}</p>
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
		<p class="d-inline-block text-truncate mb-0">{siteName} <span class="text-secondary">({url})</span></p>
	</div>
</div>