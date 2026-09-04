# Copy to deploy.config.ps1 and fill in your Hetzner values.
# deploy.config.ps1 is gitignored (contains server IP).

$DeployServer = "YOUR_HETZNER_IP"          # e.g. 49.13.xx.xx
$DeployUser   = "root"                     # or ubuntu / deploy
$DeployPath   = "/opt/chatbot-hel"         # remote app directory
$DeployKey    = "$env:USERPROFILE\.ssh\chatbot_hel_deploy"
$HostPort     = 8081                       # public port on the VPS
$CopyEnv      = $true                      # copy local whatsapp/.env to remote .env
