package main

const watchConfigFilePath = configDir + "/watch.conf"

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
