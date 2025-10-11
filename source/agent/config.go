package main

const dirBoot = "/boot"
const dirBin = "/usr/bin"
const dirSbin = "/usr/sbin"
const dirEtc = "/etc"
const dirRoot = "/root"

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
