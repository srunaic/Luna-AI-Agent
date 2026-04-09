from django.db import models
import json

class Action(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending Approval'),
        ('approved', 'Approved'),
        ('executing', 'Executing'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
    ]

    tool_name = models.CharField(max_length=100)
    arguments_json = models.TextField(default='{}')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    result = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def arguments(self):
        try:
            return json.loads(self.arguments_json)
        except:
            return {}

    def __str__(self):
        return f"{self.tool_name} ({self.status})"
