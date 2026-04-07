package main

const watchConfigFilePath = configDir + "/watch.conf"

// files larger than this are skipped; default 100 MB, overridable via server config
var maxFileSizeBytes int64 = 100 * 1024 * 1024

var defaultWatchPaths = []string{
	"/boot",
	"/usr/bin",
	"/usr/sbin",
	"/etc",
	"/root",
}

var skipPaths = []string{
	".cache",
	".config/go/telemetry",
	".bash_history",
	".lesshst",
	".viminfo",
	".local/share/recently-used.xbel",
	".mozilla",
	".thumbnails",
	"tmp",
	"temp",
	".tmp",
}

var skipEtcPaths = []string{
	"mtab",
	"resolv.conf",
	"adjtime",
}
