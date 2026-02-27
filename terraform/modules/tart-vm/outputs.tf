output "vm_ips" {
  description = "Map of VM name to IP address"
  value = {
    for vm_name, file_data in data.local_file.vm_ips :
    vm_name => trimspace(file_data.content)
  }
}
