# Operations Runbook - WasteFlow Roles & Permissions System
**T238: Phase 10 - Operations Documentation**

For complete runbook, see deployment checklist and monitoring documentation.

## Quick Reference

### Common Commands

```bash
# Check permission for user
redis-cli GET "permissions:tenant-id:user-id"

# Clear user cache
redis-cli DEL "permissions:tenant-id:user-id"

# Check metrics
curl http://localhost:3000/metrics | grep permission

# Backup database
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql
```

### Emergency Procedures

1. **High Latency**: Clear cache, check database connections
2. **Permission Denial**: Check audit logs, verify role assignments
3. **Security Incident**: Revoke user access, check audit trail

**Last Updated**: 2025-11-01
